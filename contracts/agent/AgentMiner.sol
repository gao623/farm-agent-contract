// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../interface/IZooKeeperFarming.sol";
import "../interface/IWaspFarming.sol";
import "../interface/IBoosting.sol";
import "../interface/IZooNFT.sol";
import "../interface/IHelp.sol";
import "./AgentStorage.sol";

contract AgentMiner is Ownable, ERC721Holder, AgentStorage {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event LoadPool(address indexed farm, uint256 indexed zooPid);
    event Deposit(address indexed user, uint256 indexed pid, uint256 amount, uint256 nftTokenId);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount, uint256 zooReward, uint256 devReward, uint256 waspReward);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount, uint256 zooReward, uint256 devReward, uint256 waspReward);

    modifier onlyValidPool(uint256 _pid) {
        require(_pid < poolLength(), "invalid pid");
        _;
    }

    constructor(
        address _zooKeeprFarming,
        address _devaddr,
        address _helpAddr
    ) public {
        zooKeeperFarming = _zooKeeprFarming;
        devaddr = _devaddr;
        helpAddr = _helpAddr;
        wanswapFarming = IZooKeeperFarming(_zooKeeprFarming).wanswapFarming();
        boostingAddr = IZooKeeperFarming(_zooKeeprFarming).boostingAddr();
        zoo = IZooKeeperFarming(_zooKeeprFarming).zoo();
        wasp = IZooKeeperFarming(_zooKeeprFarming).wasp();
    }

    // Load a ZooKeeper pool. Can be called by everybody.
    function add(uint256 _pid) external onlyValidPool(_pid) {
        AgentPool storage agent = agentPool[_pid];
        if (address(agent.lpToken) == address(0)) {
            loadPool(_pid);
        }
    }

    // Deposit LP tokens to ZooKeeperFarming for ZOO allocation.
    function deposit(uint256 _pid, uint256 _amount, uint256 _nftTokenId) external {
        updatePool(_pid);

        AgentPool storage agent = agentPool[_pid];
        if (_amount != 0) {
            agent.lpToken.safeTransferFrom(msg.sender, address(this), _amount);
        }

        address poolNftOwner = agent.nftOwner;
        uint256 poolNftTokenId = agent.nftTokenId;
        uint256 lpSupply = zooPoolSupply(_pid);
        bool canReplacePoolNft = canReplaceNFT(_nftTokenId, poolNftTokenId, boostingAddr);
        canReplacePoolNft = canReplacePoolNft && (lpSupply.add(_amount) != 0);

        if (canReplacePoolNft) {
            // return old nft, and transfer nft reward
            IZooKeeperFarming(zooKeeperFarming).withdraw(_pid, lpSupply);

            // update nftOwner and nftTokenId
            updateNftTokenIdAndOwner(_pid, _nftTokenId, msg.sender);

            // new nft trasfer from new nftOwner
            IERC721 nftToken = IERC721(getNftAddress(boostingAddr));
            nftToken.safeTransferFrom(msg.sender, address(this), _nftTokenId);
            if (!nftToken.isApprovedForAll(address(this), boostingAddr)) {
                nftToken.setApprovalForAll(boostingAddr, true);
            }

            // return old nft to old nftOwner
            if (poolNftOwner != address(0) && IHelp(helpAddr).isValidNftTokenId(poolNftTokenId)) {
                nftToken.safeTransferFrom(address(this), poolNftOwner, poolNftTokenId);
            }
        } else {
            // withdraw reward
            IZooKeeperFarming(zooKeeperFarming).withdraw(_pid, 0);
        }

        address zooTokenAddr = zoo;
        uint256 poolZooNftReward = agent.nftUserZooReward;
        // transfer nft reward
        if (poolZooNftReward != 0) {
            // transfer nft reward to nft owner
            agent.nftUserZooReward = 0;
            safeRewardTokenTransfer(zooTokenAddr, poolNftOwner, poolZooNftReward);
        }

        // transfer dev reward
        uint256 pendDevZoo = devZoo;
        if (pendDevZoo != 0) {
            devZoo = 0;
            safeRewardTokenTransfer(zooTokenAddr, devaddr, pendDevZoo);
        }

        // transfer user lp zoo reward
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 userLpAmount = user.amount;
        if (userLpAmount != 0) {
            uint256 pending = userLpAmount.mul(agent.accZooPerShare).div(1e12).sub(user.zooRewardDebt);
            safeRewardTokenTransfer(zooTokenAddr, msg.sender, pending);
        }

        // update user lp amount, zooRewardDebt
        user.amount = userLpAmount.add(_amount);
        user.zooRewardDebt = user.amount.mul(agent.accZooPerShare).div(1e12);

        // transfer user lp wasp reward,  and update user lp waspRewardDebt
        if (agent.dualFarmingEnable) {
            uint256 waspPending = userLpAmount.mul(agent.accWaspPerShare).div(1e12).sub(user.waspRewardDebt);
            safeRewardTokenTransfer(wasp, msg.sender, waspPending);
            user.waspRewardDebt = user.amount.mul(agent.accWaspPerShare).div(1e12);
        }

        // deposit to zoo farming
        if (canReplacePoolNft) {
            lpSupply = lpSupply.add(_amount);
            agent.lpToken.approve(zooKeeperFarming, lpSupply);
            IZooKeeperFarming(zooKeeperFarming).deposit(_pid, lpSupply, 0, _nftTokenId);
            emit Deposit(msg.sender, _pid, _amount, _nftTokenId);
        } else {
            agent.lpToken.approve(zooKeeperFarming, _amount);
            IZooKeeperFarming(zooKeeperFarming).deposit(_pid, _amount, 0, IHelp(helpAddr).nilTokenId());
            emit Deposit(msg.sender, _pid, _amount, 0);
        }
    }

    // Withdraw LP tokens from ZooKeeperFarming.
    function withdraw(uint256 _pid, uint256 _amount, uint256 _nftWithdraw) external {
        updatePool(_pid);

        AgentPool storage agent = agentPool[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 userLpAmount = user.amount;
        uint256 userPendLpZoo = userLpAmount.mul(agent.accZooPerShare).div(1e12).sub(user.zooRewardDebt);

        user.amount = user.amount.sub(_amount);
        user.zooRewardDebt = user.amount.mul(agent.accZooPerShare).div(1e12);

        uint256 nftTokenId = agent.nftTokenId;
        address poolNftOwner = agent.nftOwner;
        bool isWithdrawNft = (msg.sender == poolNftOwner) && (_nftWithdraw != 0);

        // withdraw from zoo farming
        if (isWithdrawNft) {
            uint256 lpSupply = zooPoolSupply(_pid);
            IZooKeeperFarming(zooKeeperFarming).withdraw(_pid, lpSupply);
            if (lpSupply != _amount) {
                lpSupply = lpSupply.sub(_amount);
                agent.lpToken.approve(zooKeeperFarming, lpSupply);
                IZooKeeperFarming(zooKeeperFarming).deposit(_pid, lpSupply, 0, IHelp(helpAddr).nilTokenId());
            }
        } else {
            IZooKeeperFarming(zooKeeperFarming).withdraw(_pid, _amount);
            // if lp balance is 0 in zoo farming, return nft to the nftOwner
            isWithdrawNft = (zooPoolSupply(_pid) == 0) && poolNftOwner != address(0);
        }

        // transfer user lp reward
        address zooTokenAddr = zoo;
        safeRewardTokenTransfer(zooTokenAddr, msg.sender, userPendLpZoo);

        // // transfer dev reward
        uint256 pendDevZoo = devZoo;
        if (pendDevZoo != 0) {
            devZoo = 0;
            safeRewardTokenTransfer(zooTokenAddr, devaddr, pendDevZoo);
        }

        // transfer nft owner reward
        uint256 poolZooNftReward = agent.nftUserZooReward;
        if (isWithdrawNft) {
            IERC721 nftToken = IERC721(getNftAddress(boostingAddr));
            nftToken.safeTransferFrom(address(this), poolNftOwner, nftTokenId);

            updateNftTokenIdAndOwner(_pid, IHelp(helpAddr).nilTokenId(), address(0));
            agent.nftUserZooReward = 0;
            safeRewardTokenTransfer(zooTokenAddr, poolNftOwner, poolZooNftReward);
        } else if (poolZooNftReward != 0) {
            agent.nftUserZooReward = 0;
            safeRewardTokenTransfer(zooTokenAddr, poolNftOwner, poolZooNftReward);
        }

        // transfer user lp wasp reward
        uint256 waspPending;
        if (agent.dualFarmingEnable) {
            waspPending = userLpAmount.mul(agent.accWaspPerShare).div(1e12).sub(user.waspRewardDebt);
            user.waspRewardDebt = user.amount.mul(agent.accWaspPerShare).div(1e12);
            safeRewardTokenTransfer(wasp, msg.sender, waspPending);
        }

        // transfer user token
        if (_amount != 0) {
            agent.lpToken.safeTransfer(msg.sender, _amount);
        }
        emit Withdraw(msg.sender, _pid, _amount, userPendLpZoo, pendDevZoo, waspPending);
    }

    // Try to withdraw nft. EMERGENCY ONLY.
    function emergencyClaimPoolNFT(uint256 _pid, uint256 _nftTokenId) external onlyOwner {
        require(zooPoolEmergencyMode(_pid), "emergency only");

        AgentPool storage agent = agentPool[_pid];
        address poolNftOwner = agent.nftOwner;
        if (poolNftOwner == address(0)) {
            return;
        }

        uint256 poolNftTokenId = agent.nftTokenId;
        if (!IHelp(helpAddr).isValidNftTokenId(_nftTokenId)) {
            uint256 lpSupply = zooPoolSupply(_pid);
            IZooKeeperFarming(zooKeeperFarming).withdraw(_pid, lpSupply);
            // uint256 poolNftTokenId = agent.nftTokenId;

            IERC721 nftToken = IERC721(getNftAddress(boostingAddr));
            require(nftToken.ownerOf(poolNftTokenId) == address (this), "withdraw nft failed") ;
            updateNftTokenIdAndOwner(_pid, IHelp(helpAddr).nilTokenId(), address(0));
            nftToken.safeTransferFrom(address(this), poolNftOwner, poolNftTokenId);
        } else {
            IERC721 nftToken = IERC721(getNftAddress(boostingAddr));
            nftToken.safeTransferFrom(msg.sender, address(this), _nftTokenId);
            if (!nftToken.isApprovedForAll(address(this), boostingAddr)) {
                nftToken.setApprovalForAll(boostingAddr, true);
            }
            IZooKeeperFarming(zooKeeperFarming).deposit(_pid, 0, 0, _nftTokenId);
            require(nftToken.ownerOf(poolNftTokenId) == address (this), "withdraw nft failed with new nft") ;

            updateNftTokenIdAndOwner(_pid, _nftTokenId, msg.sender);
            nftToken.safeTransferFrom(address(this), poolNftOwner, poolNftTokenId);
        }
        // uint256 lpSupply = zooPoolSupply(_pid);
        // IZooKeeperFarming(zooKeeperFarming).withdraw(_pid, lpSupply);
        // updateNftTokenIdAndOwner(_pid, IHelp(helpAddr).nilTokenId(), address(0));
        // uint256 poolNftTokenId = agent.nftTokenId;
        // IERC721 nftToken = IERC721(getNftAddress(boostingAddr));
        // nftToken.safeTransferFrom(address(this), poolNftOwner, poolNftTokenId);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdrawEnable(uint256 _pid, uint256 ignoreNft) external onlyOwner {
        AgentPool storage agent = agentPool[_pid];
        require((ignoreNft != 0) || (agent.nftOwner == address(0)), "emergency withdraw nft first");
        agent.emergencyMode = true;
        // agent.dualFarmingEnable = false;
        IZooKeeperFarming(zooKeeperFarming).emergencyWithdraw(_pid);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) external {
        AgentPool storage agent = agentPool[_pid];
        require(agent.emergencyMode, "disable emergence mode");
        agent.lastRewardBlock = block.number;

        // uint256 poolNftTokenId = agent.nftTokenId;
        // address poolNftOwner = agent.nftOwner;
        // if (poolNftOwner != address(0) && IHelp(helpAddr).isValidNftTokenId(poolNftTokenId)) {
        //     IERC721 nftToken = IERC721(getNftAddress(boostingAddr));
        //     if (nftToken.ownerOf(poolNftTokenId) == address (this)) {
        //         updateNftTokenIdAndOwner(_pid, IHelp(helpAddr).nilTokenId(), address(0));
        //         nftToken.safeTransferFrom(address(this), poolNftOwner, poolNftTokenId);
        //     }
        // }

        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;

        uint256 waspPending;
        uint256 zooPending = amount.mul(agent.accZooPerShare).div(1e12).sub(user.zooRewardDebt);
        if (agent.dualFarmingEnable) {
            waspPending = amount.mul(agent.accWaspPerShare).div(1e12).sub(user.waspRewardDebt);
        }
        // user.waspRewardDebt = amount.mul(agent.accWaspPerShare).div(1e12);
        // user.zooRewardDebt = user.amount.mul(agent.accZooPerShare).div(1e12);
        user.amount = 0;
        user.zooRewardDebt = 0;
        user.waspRewardDebt = 0;

        IERC20 zooToken = IERC20(zoo);
        uint256 totalPendingZoo = zooToken.balanceOf(address(this));
        if (totalPendingZoo >= zooPending) {
            safeRewardTokenTransfer(address(zooToken), msg.sender, zooPending);
            totalPendingZoo = totalPendingZoo.sub(zooPending);
        }
        uint256 pendDevZoo = devZoo;
        if (pendDevZoo != 0 && totalPendingZoo >= pendDevZoo) {
            devZoo = 0;
            safeRewardTokenTransfer(address(zooToken), devaddr, pendDevZoo);
        } else {
            pendDevZoo = 0;
        }
        safeRewardTokenTransfer(wasp, msg.sender, waspPending);

        agent.lpToken.safeTransfer(msg.sender, amount);
        emit EmergencyWithdraw(msg.sender, _pid, amount, zooPending, pendDevZoo, waspPending);
    }

    // Update reward variables of the given agent to be up-to-date.
    function updatePool(uint256 _pid) public onlyValidPool(_pid) {
        AgentPool storage agent = agentPool[_pid];
        if (address(agent.lpToken) == address(0)) {
            loadPool(_pid);
        }

        uint256 lpSupply = zooPoolSupply(_pid);
        // uint256 lpSupply;
        // (lpSupply,,) = IZooKeeperFarming(zooKeeperFarming).userInfo(_pid, address(this));
        if (lpSupply == 0) {
            lpSupply = agent.lpToken.balanceOf(address(this));
        }
        if (lpSupply == 0) {
            if (agent.lastRewardBlock < block.number) {
                agent.lastRewardBlock = block.number;
            }
            return;
        }

        if (block.number <= agent.lastRewardBlock) {
            return;
        }

        uint256 nftOwnerPendReward;
        uint256 devPendReward;
        uint256 lpPendReward;
        (nftOwnerPendReward,devPendReward,lpPendReward) = pendingPoolBoostedZoo(_pid);
        agent.accZooPerShare = agent.accZooPerShare.add(lpPendReward.mul(1e12).div(lpSupply));
        agent.nftUserZooReward = agent.nftUserZooReward.add(nftOwnerPendReward);
        devZoo = devZoo.add(devPendReward);

        if (agent.dualFarmingEnable) {
            uint256 waspReward = IZooKeeperFarming(zooKeeperFarming).pendingWasp(_pid, address(this));
            agent.accWaspPerShare = agent.accWaspPerShare.add(waspReward.mul(1e12).div(lpSupply));
        }
        agent.lastRewardBlock = block.number;
    }

    // function withdrawNftOwnerReward(uint256 _pid) external {
    //     AgentPool storage agent = agentPool[_pid];
    //     address nftOwner = agent.nftOwner;
    //     address zooTokenAddr = zoo;
    //     uint256 pendNftUserZooReward = agent.nftUserZooReward;
    //     if (nftOwner != address(0) && pendNftUserZooReward != 0) {
    //         agent.nftUserZooReward = 0;
    //         safeRewardTokenTransfer(zooTokenAddr, nftOwner, pendNftUserZooReward);
    //     }
    // }

    // function withdrawDevReward() external {
    //     uint256 pendDevZoo = devZoo;
    //     address zooTokenAddr = zoo;
    //     if (pendDevZoo != 0) {
    //         devZoo = 0;
    //         safeRewardTokenTransfer(zooTokenAddr, devaddr, pendDevZoo);
    //     }
    // }

    // Update dev address by the previous dev.
    function dev(address _devaddr) external {
        require(msg.sender == devaddr, "Should be dev address");
        devaddr = _devaddr;
    }

    function poolLength() public view returns (uint256 length) {
        length = IZooKeeperFarming(zooKeeperFarming).poolLength();
    }

    /* get function */
    // View function to see pending ZOOs on frontend.
    function pendingZoo(uint256 _pid, address _user) external view returns (uint256) {
        AgentPool storage agent = agentPool[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accZooPerShare = agent.accZooPerShare;
        uint256 userPendZoo;

        uint256 lpSupply = zooPoolSupply(_pid);
        // uint256 lpSupply;
        // (lpSupply,,) = IZooKeeperFarming(zooKeeperFarming).userInfo(_pid, address(this));

        uint256 nftOwnerPendReward;
        uint256 devPendReward;
        uint256 lpPendReward;
        if (lpSupply != 0) {
            (nftOwnerPendReward,devPendReward,lpPendReward) = pendingPoolBoostedZoo(_pid);
            accZooPerShare = accZooPerShare.add(lpPendReward.mul(1e12).div(lpSupply));
        }
        if (agent.nftOwner == _user) {
            userPendZoo = userPendZoo.add(agent.nftUserZooReward).add(nftOwnerPendReward);
        }
        if (devaddr == _user) {
            userPendZoo = userPendZoo.add(devPendReward).add(devZoo);
        }
        return userPendZoo.add(user.amount.mul(accZooPerShare).div(1e12).sub(user.zooRewardDebt));
    }

    function pendingWasp(uint256 _pid, address _user) external view returns (uint256) {
        AgentPool storage agent = agentPool[_pid];
        if (!agent.dualFarmingEnable) {
            return 0;
        }

        UserInfo storage user = userInfo[_pid][_user];
        uint256 accWaspPerShare = agent.accWaspPerShare;
        uint256 lpSupply = zooPoolSupply(_pid);
        // uint256 lpSupply;
        // (lpSupply,,) = IZooKeeperFarming(zooKeeperFarming).userInfo(_pid, address(this));

        if (lpSupply != 0) {
            uint256 waspReward = IZooKeeperFarming(zooKeeperFarming).pendingWasp(_pid, address(this));
            accWaspPerShare = accWaspPerShare.add(waspReward.mul(1e12).div(lpSupply));
        }
        return user.amount.mul(accWaspPerShare).div(1e12).sub(user.waspRewardDebt);
    }

    /** get function */
    // View function to see pending ZOOs on frontend.
    function pendingZooDetail(uint256 _pid, address _user) external view returns (uint256 userPending,uint256 nftOwnerPending,uint256 devPending,uint256 lpPending) {
        AgentPool storage agent = agentPool[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accZooPerShare = agent.accZooPerShare;
        uint256 userPendZoo;

        uint256 lpSupply = zooPoolSupply(_pid);
        // uint256 lpSupply;
        // (lpSupply,,) = IZooKeeperFarming(zooKeeperFarming).userInfo(_pid, address(this));

        uint256 nftOwnerPendReward;
        uint256 devPendReward;
        uint256 lpPendReward;
        if (lpSupply != 0) {
            (nftOwnerPendReward,devPendReward,lpPendReward) = pendingPoolBoostedZoo(_pid);
            accZooPerShare = accZooPerShare.add(lpPendReward.mul(1e12).div(lpSupply));
        }
        if (agent.nftOwner == _user) {
            userPendZoo = userPendZoo.add(agent.nftUserZooReward).add(nftOwnerPendReward);
        }
        if (devaddr == _user) {
            userPendZoo = userPendZoo.add(devPendReward).add(devZoo);
        }
        userPending = userPendZoo.add(user.amount.mul(accZooPerShare).div(1e12).sub(user.zooRewardDebt));
        nftOwnerPending = nftOwnerPendReward;
        devPending = devPendReward;
        lpPending = lpPendReward;
    }

    function canReplacePoolNFT(uint256 _pid, uint256 _nftTokenId) external view returns (bool canReplace) {
        AgentPool storage agent = agentPool[_pid];
        canReplace = canReplaceNFT(_nftTokenId, agent.nftTokenId, boostingAddr);
    }

    /********* private **********/
    function loadPool(uint256 _pid) private {
        uint256 lastRewardBlock;
        uint256 accZooPerShare;
        uint256 accWaspPerShare;
        address lpToken;
        bool dualFarmingEnable;
        bool emergencyMode;

        // (lpToken,,lastRewardBlock,accZooPerShare,,accWaspPerShare,dualFarmingEnable,emergencyMode) = IZooKeeperFarming(zooKeeperFarming).poolInfo(_pid);
        (lpToken,,lastRewardBlock,accZooPerShare,,accWaspPerShare,dualFarmingEnable,emergencyMode) = zooPoolInfo(_pid);

        AgentPool storage agent = agentPool[_pid];
        agent.lastRewardBlock = block.number;
        // agent.accZooPerShare = 0;
        // agent.accWaspPerShare = 0;
        agent.dualFarmingEnable = dualFarmingEnable;
        agent.emergencyMode = emergencyMode;
        // agent.nftUserZooReward = 0;
        // agent.nftOwner = address(0);
        agent.lpToken = IERC20(lpToken);
        // agent.disable = false;

        emit LoadPool(zooKeeperFarming, _pid);
    }

    function updateNftTokenIdAndOwner(uint _pid, uint256 _nftTokenId, address _nftOwner) private {
        AgentPool storage agent = agentPool[_pid];
        agent.nftOwner = _nftOwner;
        agent.nftTokenId = _nftTokenId;
    }

    function canReplaceNFT(uint256 _newNftTokenId, uint256 _oldNftTokenId, address _boostingAddr) private view returns (bool canReplacePoolNft) {
      if (IHelp(helpAddr).isValidNftTokenId(_newNftTokenId)) {
        IZooNFT nftToken = IZooNFT(getNftAddress(_boostingAddr));
        uint256 newNftBoosting = nftToken.getBoosting(_newNftTokenId);

        if (IHelp(helpAddr).isValidNftTokenId(_oldNftTokenId)) {
          uint256 oldNftBoosting = nftToken.getBoosting(_oldNftTokenId);
          canReplacePoolNft = (newNftBoosting > oldNftBoosting);
        } else {
          canReplacePoolNft = true;
        }
      }
    }

    // View function to see pending ZOOs on frontend.
    function pendingPoolBoostedZoo(uint256 _pid) private view returns (uint256 nftOwnerPendReward, uint256 devPendReward, uint256 lpPendReward) {
        AgentPool storage agent = agentPool[_pid];
        uint256 agentLastRewardBlock = agent.lastRewardBlock;

        if (block.number > agentLastRewardBlock) {
            uint256 totalPendRewardWithoutNFT;
            uint256 totalPendRewardPureByNFT;

            // TODO
            uint256 totalPendRewardWithNFT = getPendingZoo(_pid, address(this));
            uint256 boostMultiplier = IBoosting(boostingAddr).getMultiplier(_pid, address(this));
            uint256 maxMultiplier = zooMaxMultiplier();

            if (boostMultiplier > maxMultiplier) {
                boostMultiplier = maxMultiplier;
            }
            if (boostMultiplier != 0) {
                totalPendRewardWithoutNFT = totalPendRewardWithNFT.mul(1e12).div(boostMultiplier);
            }
            totalPendRewardPureByNFT = totalPendRewardWithNFT.sub(totalPendRewardWithoutNFT);

            nftOwnerPendReward = totalPendRewardPureByNFT.mul(NFT_PERCENT).div(DENOMINATOR);
            devPendReward = totalPendRewardPureByNFT.mul(TEAM_PERCENT).div(DENOMINATOR);
            lpPendReward = totalPendRewardWithNFT.sub(nftOwnerPendReward).sub(devPendReward);
        }
    }

    // Safe wasp transfer function, just in case if rounding error causes pool to not have enough WASP.
    function safeRewardTokenTransfer(address _token, address _to, uint256 _amount) private {
        if (_amount != 0) {
            IERC20(_token).transfer(_to, _amount);
        }
    }

    // function safeERC20TokenTransfer(address _token, address _to, uint256 _amount) private {
    //     if (_amount != 0) {
    //         IERC20(_token).safeTransfer(_to, _amount);
    //     }
    // }

    function zooPoolInfo(uint256 _pid) private view returns (address lpToken, uint256 allocPoint, uint256 lastRewardBlock, uint256 accZooPerShare, uint256 waspPid, uint256 accWaspPerShare, bool dualFarmingEnable, bool emergencyMode) {
        (lpToken,allocPoint,lastRewardBlock,accZooPerShare,waspPid,accWaspPerShare,dualFarmingEnable,emergencyMode) = IZooKeeperFarming(zooKeeperFarming).poolInfo(_pid);
    }

    function zooPoolEmergencyMode(uint256 _pid) private view returns (bool emergencyMode) {
        (,,,,,,,emergencyMode) = IZooKeeperFarming(zooKeeperFarming).poolInfo(_pid);
    }

    function zooPoolSupply(uint256 _pid) private view returns (uint256 lpSupply) {
        (lpSupply,,) = IZooKeeperFarming(zooKeeperFarming).userInfo(_pid, address(this));
    }

    function zooMaxMultiplier() private view returns (uint256 maxMultiplier) {
        maxMultiplier = IZooKeeperFarming(zooKeeperFarming).maxMultiplier();
    }

    function getNftAddress(address _boostingAddr) private view returns (address NFTAddress) {
        NFTAddress = IBoosting(_boostingAddr).NFTAddress();
    }

    function getPendingZoo(uint256 _pid, address _user) private view returns(uint256 userPendZoo) {
        userPendZoo = IZooKeeperFarming(zooKeeperFarming).pendingZoo(_pid, _user);
    }

}
