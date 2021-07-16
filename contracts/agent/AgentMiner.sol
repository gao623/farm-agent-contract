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
import "./AgentStorage.sol";

contract AgentMiner is Ownable, ERC721Holder, AgentStorage {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event LoadPool(address indexed farm, uint256 indexed zooPid);
    event Deposit(address indexed user, uint256 indexed pid, uint256 amount, uint256 nftTokenId);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount, uint256 zooReward, uint256 devReward, uint256 waspReward);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);

    // TODO: Debug EVENT
    // event TokenBalanceDebug(address indexed token, address indexed owner, uint256 balance);

    constructor(
        address _zooKeeprFarming,
        address _devaddr
    ) public {
        zooKeeperFarming = _zooKeeprFarming;
        devaddr = _devaddr;
        wanswapFarming = IZooKeeperFarming(_zooKeeprFarming).wanswapFarming();
        boostingAddr = IZooKeeperFarming(_zooKeeprFarming).boostingAddr();
        zoo = IZooKeeperFarming(_zooKeeprFarming).zoo();
        wasp = IZooKeeperFarming(_zooKeeprFarming).wasp();
        zooPerBlock = IZooKeeperFarming(_zooKeeprFarming).zooPerBlock();
    }

    // Deposit LP tokens to ZooKeeperFarming for ZOO allocation.
    function deposit(uint256 _pid, uint256 _amount, uint256 _nftTokenId) external {
        // require (IZooKeeperFarming(zooKeeperFarming).poolLength() > _pid, "invalid agent");
        updatePool(_pid);

        AgentPool storage agent = agentPool[getAgentIndex(_pid)];
        // AgentPool storage agent = agentPool[_pid];

        if (_amount != 0) {
            agent.lpToken.safeTransferFrom(msg.sender, address(this), _amount);
        }

        // update nft token or not
        uint256 oldNftTokenId;
        // address boostingAddr = zooBoostingAddress();
        bool needUpdatePoolNft;
        if (_nftTokenId != 0) {
            (oldNftTokenId, needUpdatePoolNft) = canReplacePoolNFT(_pid, _nftTokenId, boostingAddr);
            require(needUpdatePoolNft, "nft too slow");
        }

        uint256 lpSupply = zooPoolSupply(_pid);
        address zooTokenAddr = zoo;
        needUpdatePoolNft = needUpdatePoolNft && (lpSupply.add(_amount) != 0);
        if (needUpdatePoolNft) {
            // return old nft, and transfer nft reward
            IZooKeeperFarming(zooKeeperFarming).withdraw(_pid, lpSupply);

            address oldNftOwner = agent.nftOwner;
            agent.nftOwner = msg.sender;

            IERC721 nftToken = IERC721(getNftAddress(boostingAddr));
            // IERC721 nftToken = IERC721(IBoosting(boostingAddr).NFTAddress());
            if (!nftToken.isApprovedForAll(address(this), boostingAddr)) {
                nftToken.setApprovalForAll(boostingAddr, true);
            }

            nftToken.safeTransferFrom(msg.sender, address(this), _nftTokenId);
            if (oldNftTokenId != 0) {
                // if (!nftToken.isApprovedForAll(address(this), oldNftOwner)) {
                //     nftToken.setApprovalForAll(oldNftOwner, true);
                // }
                nftToken.safeTransferFrom(address(this), oldNftOwner, oldNftTokenId);
            }

            uint256 oldZooNftReward = agent.nftUserZooReward;
            agent.nftUserZooReward = 0;
            safeERC20TokenTransfer(zooTokenAddr, oldNftOwner, oldZooNftReward);
        } else {
            IZooKeeperFarming(zooKeeperFarming).withdraw(_pid, 0);
        }

        if (devZoo != 0) {
            uint256 pendDevZoo = devZoo;
            devZoo = 0;
            safeERC20TokenTransfer(zooTokenAddr, devaddr, pendDevZoo);
        }

        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 userOldAmount = user.amount;
        if (userOldAmount != 0) {
            uint256 pending = userOldAmount.mul(agent.accZooPerShare).div(1e12).sub(user.zooRewardDebt);
            safeERC20TokenTransfer(zooTokenAddr, msg.sender, pending);
        }

        user.amount = userOldAmount.add(_amount);
        user.zooRewardDebt = user.amount.mul(agent.accZooPerShare).div(1e12);

        if (agent.dualFarmingEnable) {
            uint256 waspPending = userOldAmount.mul(agent.accWaspPerShare).div(1e12).sub(user.waspRewardDebt);
            safeERC20TokenTransfer(wasp, msg.sender, waspPending);
            user.waspRewardDebt = user.amount.mul(agent.accWaspPerShare).div(1e12);
        }

        if (needUpdatePoolNft) {
            lpSupply = lpSupply.add(_amount);
            agent.lpToken.approve(zooKeeperFarming, lpSupply);
            IZooKeeperFarming(zooKeeperFarming).deposit(_pid, lpSupply, 0, _nftTokenId);
        } else {
            agent.lpToken.approve(zooKeeperFarming, _amount);
            IZooKeeperFarming(zooKeeperFarming).deposit(_pid, _amount, 0, _nftTokenId);
        }

        emit Deposit(msg.sender, _pid, _amount, _nftTokenId);
    }

    // Withdraw LP tokens from ZooKeeperFarming.
    function withdraw(uint256 _pid, uint256 _amount) external {
        updatePool(_pid);

        AgentPool storage agent = agentPool[getAgentIndex(_pid)];
        // AgentPool storage agent = agentPool[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 userOldAmount = user.amount;
        uint256 pendingZoo = userOldAmount.mul(agent.accZooPerShare).div(1e12).sub(user.zooRewardDebt);

        user.amount = user.amount.sub(_amount);
        user.zooRewardDebt = user.amount.mul(agent.accZooPerShare).div(1e12);

        bool isNftOwner = msg.sender == agent.nftOwner;
        bool isNftOwnerWithdrawAll = isNftOwner && user.amount == 0;
        uint256 nftTokenId;
        if (isNftOwnerWithdrawAll) {
            nftTokenId = getPoolNftTokenId(_pid, boostingAddr);
            // nftTokenId = getBoostUserTokenId(boostingAddr, _pid, address(this));
        }

        if (user.amount == 0) {
            uint256 lpSupply = zooPoolSupply(_pid);
            IZooKeeperFarming(zooKeeperFarming).withdraw(_pid, lpSupply);
            lpSupply = lpSupply.sub(_amount);
            agent.lpToken.approve(zooKeeperFarming, lpSupply);
            IZooKeeperFarming(zooKeeperFarming).deposit(_pid, lpSupply, 0, 0);
        } else {
            IZooKeeperFarming(zooKeeperFarming).withdraw(_pid, _amount);
        }

        address zooTokenAddr = zoo;
        safeERC20TokenTransfer(zooTokenAddr, msg.sender, pendingZoo);

        uint256 pendDevZoo = devZoo;
        if (pendDevZoo != 0) {
            devZoo = 0;
            safeERC20TokenTransfer(zooTokenAddr, devaddr, pendDevZoo);
        }

        uint256 oldZooNftReward = agent.nftUserZooReward;
        if (isNftOwnerWithdrawAll) {
            IERC721 nftToken = IERC721(getNftAddress(boostingAddr));
            // IERC721 nftToken = IERC721(IBoosting(boostingAddr).NFTAddress());
            nftToken.safeTransferFrom(address(this), msg.sender, nftTokenId);

            address oldNftOwner = agent.nftOwner;
            agent.nftUserZooReward = 0;
            agent.nftOwner = address(0);
            safeERC20TokenTransfer(zooTokenAddr, oldNftOwner, oldZooNftReward);
        } else if (isNftOwner) {
            agent.nftUserZooReward = 0;
            safeERC20TokenTransfer(zooTokenAddr, agent.nftOwner, oldZooNftReward);
        }

        uint256 waspPending;
        if (agent.dualFarmingEnable) {
            waspPending = userOldAmount.mul(agent.accWaspPerShare).div(1e12).sub(user.waspRewardDebt);
            user.waspRewardDebt = user.amount.mul(agent.accWaspPerShare).div(1e12);
            safeERC20TokenTransfer(wasp, msg.sender, waspPending);
        }

        if (_amount > 0) {
            agent.lpToken.safeTransfer(msg.sender, _amount);
        }

        emit Withdraw(msg.sender, _pid, _amount, pendingZoo, pendDevZoo, waspPending);
    }

    function removeNFT(uint256 _pid) external {
        updatePool(_pid);

        AgentPool storage agent = agentPool[getAgentIndex(_pid)];
        address oldNftOwner = agent.nftOwner;
        // AgentPool storage agent = agentPool[_pid];
        require(oldNftOwner != address(0) && oldNftOwner == msg.sender, "invalid NFT owner");

        uint256 lpSupply = zooPoolSupply(_pid);
        agent.nftOwner = address(0);

        uint256 nftTokenId = getPoolNftTokenId(_pid, boostingAddr);
        if (lpSupply != 0) {
            IZooKeeperFarming(zooKeeperFarming).withdraw(_pid, lpSupply);
        }

        // return the nft
        // address boostingAddr = zooBoostingAddress();
        IERC721 nftToken = IERC721(getNftAddress(boostingAddr));
        if (nftTokenId != 0) {
            nftToken.safeTransferFrom(address(this), oldNftOwner, nftTokenId);
        }

        if (lpSupply != 0) {
            agent.lpToken.approve(zooKeeperFarming, lpSupply);
            IZooKeeperFarming(zooKeeperFarming).deposit(_pid, lpSupply, 0, 0);
        }

        uint256 pendDevZoo = devZoo;
        address zooTokenAddr = zoo;
        if (pendDevZoo != 0) {
            devZoo = 0;
            safeERC20TokenTransfer(zooTokenAddr, devaddr, pendDevZoo);
        }

        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 nftUserZooReward = agent.nftUserZooReward;
        uint256 zooPending = user.amount.mul(agent.accZooPerShare).div(1e12).sub(user.zooRewardDebt);
        user.zooRewardDebt = user.amount.mul(agent.accZooPerShare).div(1e12);
        if (nftUserZooReward != 0) {
            agent.nftUserZooReward = 0;
            zooPending = zooPending.add(nftUserZooReward);
        }
        safeERC20TokenTransfer(zooTokenAddr, msg.sender, zooPending);

        if (agent.dualFarmingEnable) {
            uint256 waspPending = user.amount.mul(agent.accWaspPerShare).div(1e12).sub(user.waspRewardDebt);
            safeERC20TokenTransfer(wasp, msg.sender, waspPending);
            user.waspRewardDebt = user.amount.mul(agent.accWaspPerShare).div(1e12);
        }

    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdrawEnable(uint256 _pid) external onlyOwner {
        AgentPool storage agent = agentPool[getAgentIndex(_pid)];
        // AgentPool storage agent = agentPool[_pid];
        agent.emergencyMode = true;
        // agent.dualFarmingEnable = false;
        IZooKeeperFarming(zooKeeperFarming).emergencyWithdraw(_pid);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) external {
        AgentPool storage agent = agentPool[getAgentIndex(_pid)];
        // AgentPool storage agent = agentPool[_pid];
        require(agent.emergencyMode, "disable emergence mode");
        agent.lastRewardBlock = block.timestamp;

        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;
        uint256 zooPending = amount.mul(agent.accZooPerShare).div(1e12).sub(user.zooRewardDebt);
        uint256 waspPending = amount.mul(agent.accWaspPerShare).div(1e12).sub(user.waspRewardDebt);
        // user.waspRewardDebt = amount.mul(agent.accWaspPerShare).div(1e12);
        // user.zooRewardDebt = user.amount.mul(agent.accZooPerShare).div(1e12);
        user.amount = 0;
        user.zooRewardDebt = 0;
        user.waspRewardDebt = 0;

        safeERC20TokenTransfer(zoo, msg.sender, zooPending);
        safeERC20TokenTransfer(wasp, msg.sender, waspPending);

        agent.lpToken.safeTransfer(msg.sender, amount);
        emit EmergencyWithdraw(msg.sender, _pid, amount);
    }

    // Update reward variables of the given agent to be up-to-date.
    function updatePool(uint256 _pid) public {

        uint256 agentIndex;
        if (!checkPoolExists(_pid)) {
            agentIndex = loadPool(_pid);
        } else {
            agentIndex = getAgentIndex(_pid);
        }
        AgentPool storage agent = agentPool[agentIndex];

        uint256 lpSupply;
        uint256 zooRewardDebt;
        uint256 waspRewardDebt;
        (lpSupply,zooRewardDebt,waspRewardDebt) = IZooKeeperFarming(zooKeeperFarming).userInfo(_pid, address(this));
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
        uint256 poolPendReward;
        (nftOwnerPendReward,devPendReward,poolPendReward) = pendingFarmingBoostedZoo(_pid);
        agent.accZooPerShare = agent.accZooPerShare.add(poolPendReward.mul(1e12).div(lpSupply));
        agent.nftUserZooReward = agent.nftUserZooReward.add(nftOwnerPendReward);
        devZoo = devZoo.add(devPendReward);

        if (agent.dualFarmingEnable) {
            uint256 waspReward = IZooKeeperFarming(zooKeeperFarming).pendingWasp(_pid, address(this));
            agent.accWaspPerShare = agent.accWaspPerShare.add(waspReward.mul(1e12).div(lpSupply));
        }
        agent.lastRewardBlock = block.number;
    }

    function withdrawDevReward() external {
        uint256 pendDevZoo = devZoo;
        address zooTokenAddr = zoo;
        if (pendDevZoo != 0) {
            devZoo = 0;
            safeERC20TokenTransfer(zooTokenAddr, devaddr, pendDevZoo);
        }
    }

    // Update dev address by the previous dev.
    function dev(address _devaddr) external {
        require(msg.sender == devaddr, "Should be dev address");
        devaddr = _devaddr;
    }

    function poolLength() external view returns (uint256 length) {
        length = agentPool.length;
    }

    /**      get function */
    // View function to see pending ZOOs on frontend.
    function pendingZoo(uint256 _pid, address _user) external view returns (uint256) {
    // function pendingZoo(uint256 _pid, address _user) external view returns (uint256) {
        AgentPool storage agent = agentPool[getAgentIndex(_pid)];
        // AgentPool storage agent = agentPool[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accZooPerShare = agent.accZooPerShare;
        uint256 pendZoo;

        uint256 lpSupply;
        (lpSupply,,) = IZooKeeperFarming(zooKeeperFarming).userInfo(_pid, address(this));

        if (lpSupply != 0) {
            uint256 nftOwnerPendReward;
            uint256 devPendReward;
            uint256 poolPendReward;
            (nftOwnerPendReward,devPendReward,poolPendReward) = pendingFarmingBoostedZoo(_pid);
            accZooPerShare = accZooPerShare.add(poolPendReward.mul(1e12).div(lpSupply));
            if (agent.nftOwner == _user) {
                pendZoo = agent.nftUserZooReward.add(nftOwnerPendReward);
            }
        }
        return pendZoo.add(user.amount.mul(accZooPerShare).div(1e12).sub(user.zooRewardDebt));
    }

    function pendingWasp(uint256 _pid, address _user) external view returns (uint256) {
        AgentPool storage agent = agentPool[getAgentIndex(_pid)];
        // AgentPool storage agent = agentPool[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accWaspPerShare = agent.accWaspPerShare;

        uint256 lpSupply;
        if (!agent.dualFarmingEnable) {
            return 0;
        }

        (lpSupply,,) = IZooKeeperFarming(zooKeeperFarming).userInfo(_pid, address(this));

        if (lpSupply != 0) {
            uint256 waspReward = IZooKeeperFarming(zooKeeperFarming).pendingWasp(_pid, address(this));
            accWaspPerShare = accWaspPerShare.add(waspReward.mul(1e12).div(lpSupply));
        }
        return user.amount.mul(accWaspPerShare).div(1e12).sub(user.waspRewardDebt);
    }

    /** get function */
    // View function to see pending ZOOs on frontend.
    function pendingZooDetail(uint256 _pid, address _user) external view returns (uint256 userPending,uint256 nftOwnerPending,uint256 devPending,uint256 poolPending) {
    // function pendingZoo(uint256 _pid, address _user) external view returns (uint256) {
        AgentPool storage agent = agentPool[getAgentIndex(_pid)];
        // AgentPool storage agent = agentPool[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accZooPerShare = agent.accZooPerShare;
        uint256 pendZoo;

        uint256 lpSupply;
        (lpSupply,,) = IZooKeeperFarming(zooKeeperFarming).userInfo(_pid, address(this));

        if (lpSupply != 0) {
            uint256 nftOwnerPendReward;
            uint256 devPendReward;
            uint256 poolPendReward;
            (nftOwnerPendReward,devPendReward,poolPendReward) = pendingFarmingBoostedZoo(_pid);
            accZooPerShare = accZooPerShare.add(poolPendReward.mul(1e12).div(lpSupply));
            if (agent.nftOwner == _user) {
                pendZoo = agent.nftUserZooReward.add(nftOwnerPendReward);
            }
            nftOwnerPending = nftOwnerPendReward;
            devPending = devPendReward;
            poolPending = poolPendReward;
        }
        userPending = pendZoo.add(user.amount.mul(accZooPerShare).div(1e12).sub(user.zooRewardDebt));
    }

    /********* private **********/

    function loadPool(uint256 _pid) private returns (uint256 agentIndex) {
        uint256 lastRewardBlock;
        uint256 accZooPerShare;
        uint256 accWaspPerShare;
        address lpToken;
        bool dualFarmingEnable;
        bool emergencyMode;

        // (lpToken,,lastRewardBlock,accZooPerShare,,accWaspPerShare,dualFarmingEnable,emergencyMode) = IZooKeeperFarming(zooKeeperFarming).poolInfo(_pid);
        (lpToken,,lastRewardBlock,accZooPerShare,,accWaspPerShare,dualFarmingEnable,emergencyMode) = zooPoolInfo(_pid);

        agentPool.push(AgentPool({
            lastRewardBlock: block.number,
            accZooPerShare: 0,
            accWaspPerShare: 0,
            dualFarmingEnable: dualFarmingEnable,
            emergencyMode: emergencyMode,
            nftUserZooReward: 0,
            nftOwner: address(0),
            lpToken: IERC20(lpToken),
            disable: false
        }));

        uint256 increasePid = _pid.add(1);
        uint256 increaseIndex = agentPool.length;
        incAgentIndex2IncPid[increaseIndex] = increasePid;
        incPid2IncAgentIndex[increasePid] = increaseIndex;

        agentIndex = increaseIndex - 1;

        emit LoadPool(zooKeeperFarming, _pid);
    }

    function canReplacePoolNFT(uint256 _pid, uint256 _nftTokenId, address _boostingAddr) private view returns (uint256 oldNftTokenId, bool canUpdatePoolNft) {
        // update nft token or not
        if ((_nftTokenId != 0) && (_boostingAddr != address(0))) {
            // IZooNFT nftToken = IZooNFT(IBoosting(_boostingAddr).NFTAddress());
            IZooNFT nftToken = IZooNFT(getNftAddress(_boostingAddr));
            uint256 nftBoosting = nftToken.getBoosting(_nftTokenId);
            // oldNftTokenId = getBoostUserTokenId(_boostingAddr, _pid, address(this));
            oldNftTokenId = getPoolNftTokenId(_pid, _boostingAddr);
            
            if (oldNftTokenId != 0) {
                uint256 oldNftBoosting = nftToken.getBoosting(oldNftTokenId);
                canUpdatePoolNft = (nftBoosting > oldNftBoosting);
            } else {
                canUpdatePoolNft = true;
            }
        }
    }

    function getAgentIndex(uint256 _pid) private view returns (uint256 index) {
        index = incPid2IncAgentIndex[_pid.add(1)].sub(1);
    }

    function checkPoolExists(uint256 _pid) private view returns (bool isExists) {
        uint256 incIndex = incPid2IncAgentIndex[_pid.add(1)];
        isExists = (incIndex != 0);
    }

    // View function to see pending ZOOs on frontend.
    function pendingFarmingBoostedZoo(uint256 _pid) private view returns (uint256 nftOwnerPendReward, uint256 devPendReward, uint256 poolPendReward) {
        uint256 lpSupply;
        uint256 zooRewardDebt;
        // AgentPool storage agent = agentPool[_pid];
        AgentPool storage agent = agentPool[getAgentIndex(_pid)];
        (lpSupply,zooRewardDebt,) = zooUserInfo(_pid);
        // (lpSupply,zooRewardDebt,) = IZooKeeperFarming(zooKeeperFarming).userInfo(_pid, address(this));
        if (lpSupply == 0 && address(agent.lpToken) != address (0)) {
            lpSupply = agent.lpToken.balanceOf(address(this));
        }

        if (lpSupply != 0) {
            uint256 zooAllocPoint;
            uint256 zooLastRewardBlock;
            uint256 accZooPerShareFarming;
            uint256 waspPid;

            (zooAllocPoint,zooLastRewardBlock,accZooPerShareFarming,waspPid) = zooPoolState(_pid);

            if (block.number > zooLastRewardBlock) {
                uint256 totalPendRewardWithoutNFT;
                uint256 totalPendRewardPureByNFT;

                (totalPendRewardWithoutNFT,totalPendRewardPureByNFT) = getFarmingUserPendZooReward(_pid, waspPid, zooLastRewardBlock, accZooPerShareFarming, zooAllocPoint, zooRewardDebt, lpSupply);

                nftOwnerPendReward = calcUserPendRewardPureOnlyNFT(_pid, totalPendRewardPureByNFT, lpSupply, agent.nftOwner);
                totalPendRewardPureByNFT = totalPendRewardPureByNFT.sub(nftOwnerPendReward);
                devPendReward = totalPendRewardPureByNFT.mul(TEAM_PERCENT).div(100);
                poolPendReward = totalPendRewardWithoutNFT.add(totalPendRewardPureByNFT).sub(devPendReward);
            }
        }
        return (nftOwnerPendReward, devPendReward, poolPendReward);
    }

    // Safe wasp transfer function, just in case if rounding error causes pool to not have enough WASP.
    function safeERC20TokenTransfer(address _token, address _to, uint256 _amount) private {
        if (_amount != 0) {
            IERC20(_token).transfer(_to, _amount);
            // IERC20(_token).safeTransfer(_to, _amount);
        }
    }

    // function getZooPoolTotalSupply(uint256 _pid, uint256 _waspPid) private view returns (uint256 lpSupply) {
    //     AgentPool storage agent = agentPool[getAgentIndex(_pid)];
    //     if (wanswapFarming == address(0) || !agent.dualFarmingEnable) {
    //         lpSupply = agent.lpToken.balanceOf(zooKeeperFarming);
    //     } else {
    //         // (lpSupply,) = IWaspFarming(wanswapFarming).userInfo(_waspPid, zooKeeperFarming);
    //         lpSupply = getWaspUserAmount(_waspPid, zooKeeperFarming);
    //     }
    // }

    function getWaspUserAmount(uint256 _waspPid, address _user) private view returns (uint256 amount) {
        (amount,) = IWaspFarming(wanswapFarming).userInfo(_waspPid, _user);
    }

    function getFarmingUserPendZooReward(uint256 _pid, uint256 _waspPid, uint256 _zooLastRewardBlock, uint256 _accZooPerShareFarming, uint256 _zooAllocPoint, uint256 _zooRewardDebt, uint256 _userAmount) private view returns (uint256 totalPendRewardWithoutNFT, uint256 totalPendRewardPureByNFT) {
        // uint256 poolZooTotalSupply = getZooPoolTotalSupply(_pid, _waspPid);
        uint256 poolZooTotalSupply;
        AgentPool storage agent = agentPool[getAgentIndex(_pid)];
        if (wanswapFarming == address(0) || !agent.dualFarmingEnable) {
            poolZooTotalSupply = agent.lpToken.balanceOf(zooKeeperFarming);
        } else {
            // (poolZooTotalSupply,) = IWaspFarming(wanswapFarming).userInfo(_waspPid, zooKeeperFarming);
            poolZooTotalSupply = getWaspUserAmount(_waspPid, zooKeeperFarming);
        }

        if (poolZooTotalSupply != 0) {
            uint256 zooTotalAllocPoint = IZooKeeperFarming(zooKeeperFarming).totalAllocPoint();
            uint256 zooMultiplier = IZooKeeperFarming(zooKeeperFarming).getMultiplier(_zooLastRewardBlock, block.number);
            uint256 poolZooTotalReward = zooMultiplier.mul(zooPerBlock).mul(_zooAllocPoint).div(zooTotalAllocPoint);
            _accZooPerShareFarming = _accZooPerShareFarming.add(poolZooTotalReward.mul(1e12).div(poolZooTotalSupply));
        }

        totalPendRewardWithoutNFT = _userAmount.mul(_accZooPerShareFarming).div(1e12).sub(_zooRewardDebt);
        // totalPendRewardWithNFT = totalPendRewardWithoutNFT;
        uint256 totalPendRewardWithNFT = totalPendRewardWithoutNFT;

        uint256 boostMultiplier = IBoosting(boostingAddr).getMultiplier(_pid, address(this));
        uint256 maxMultiplier = zooMaxMultiplier();
        // uint256 maxMultiplier = IZooKeeperFarming(zooKeeperFarming).maxMultiplier();
        if (boostMultiplier > maxMultiplier) {
            boostMultiplier = maxMultiplier;
        }
        totalPendRewardWithNFT = totalPendRewardWithNFT.mul(boostMultiplier).div(1e12);
        totalPendRewardPureByNFT = totalPendRewardWithNFT.sub(totalPendRewardWithoutNFT);
    }

    // function getUserAmount(uint256 _pid, address _user) private view returns (uint256) {
    //     UserInfo storage user = userInfo[_pid][_user];
    //     return user.amount;
    // }

    function calcUserPendRewardPureOnlyNFT(uint256 _pid, uint256 _totalPendRewardPureByNFT, uint256 _lpSupply, address nftOwner) private view returns (uint256 nftOwnerPendReward) {
        nftOwnerPendReward = userInfo[_pid][nftOwner].amount.mul(_totalPendRewardPureByNFT).div(_lpSupply);
    }
    // // Safe wasp transfer function, just in case if rounding error causes pool to not have enough WASP.
    // function safeERC20TokenTransfer(address _token, address _to, uint256 _amount) private {
    //     uint256 balance = IERC20(_token).balanceOf(address(this));
    //     if (_amount > balance) {
    //         IERC20(_token).transfer(_to, balance);
    //     } else {
    //         IERC20(_token).transfer(_to, _amount);
    //     }
    // }
/*
    function transfer(address tokenScAddr, address to, uint value)
        internal
        returns(bool)
    {
        uint beforeBalance;
        uint afterBalance;
        beforeBalance = IRC20Protocol(tokenScAddr).balanceOf(to);
        // IRC20Protocol(tokenScAddr).transfer(to, value);
        tokenScAddr.call(bytes4(keccak256("transfer(address,uint256)")), to, value);
        afterBalance = IRC20Protocol(tokenScAddr).balanceOf(to);
        return afterBalance == beforeBalance.add(value);
    }

    function transferFrom(address tokenScAddr, address from, address to, uint value)
        internal
        returns(bool)
    {
        uint beforeBalance;
        uint afterBalance;
        beforeBalance = IRC20Protocol(tokenScAddr).balanceOf(to);
        // IRC20Protocol(tokenScAddr).transferFrom(from, to, value);
        tokenScAddr.call(bytes4(keccak256("transferFrom(address,address,uint256)")), from, to, value);
        afterBalance = IRC20Protocol(tokenScAddr).balanceOf(to);
        return afterBalance == beforeBalance.add(value);
    }
*/

    // function getPoolNFT(uint256 _pid, address _boostingAddr) public view returns (uint256 oldNftTokenId) {
    //     // update nft token or not
    //     if ((_boostingAddr != address(0))) {
    //         oldNftTokenId = getBoostUserTokenId(_boostingAddr, _pid, address(this));
    //     }
    // }

    // function waspUserInfo(uint256 _pid) private view returns (uint256 lpSupply, uint256 waspRewardDebt) {
    //     (lpSupply,waspRewardDebt) = IWaspFarming(wanswapFarming).userInfo(_pid, address(this));
    // }

    function zooPoolInfo(uint256 _pid) private view returns (address lpToken, uint256 allocPoint, uint256 lastRewardBlock, uint256 accZooPerShare, uint256 waspPid, uint256 accWaspPerShare, bool dualFarmingEnable, bool emergencyMode) {
        (lpToken,allocPoint,lastRewardBlock,accZooPerShare,waspPid,accWaspPerShare,dualFarmingEnable,emergencyMode) = IZooKeeperFarming(zooKeeperFarming).poolInfo(_pid);
    }

    function isPoolEmergencyWithdrawEnable(uint256 _pid) private view returns (bool dualFarmingEnable, bool emergencyMode) {
        (,,,,,,dualFarmingEnable,emergencyMode) = IZooKeeperFarming(zooKeeperFarming).poolInfo(_pid);
    }

    function zooPoolState(uint256 _pid) private view returns (uint256 allocPoint, uint256 lastRewardBlock, uint256 accZooPerShare, uint256 waspPid) {
        (,allocPoint,lastRewardBlock,accZooPerShare,waspPid,,,) = IZooKeeperFarming(zooKeeperFarming).poolInfo(_pid);
    }

    function zooUserInfo(uint256 _pid) private view returns (uint256 lpSupply, uint256 zooRewardDebt, uint256 waspRewardDebt) {
        (lpSupply,zooRewardDebt,waspRewardDebt) = IZooKeeperFarming(zooKeeperFarming).userInfo(_pid, address(this));
    }

    function zooPoolSupply(uint256 _pid) private view returns (uint256 lpSupply) {
        (lpSupply,,) = IZooKeeperFarming(zooKeeperFarming).userInfo(_pid, address(this));
    }

    // function zooBoostingAddress() private view returns (address boostingAddr_) {
    //     boostingAddr_ = IZooKeeperFarming(zooKeeperFarming).boostingAddr();
    // }

    function zooMaxMultiplier() private view returns (uint256 maxMultiplier) {
        maxMultiplier = IZooKeeperFarming(zooKeeperFarming).maxMultiplier();
    }

    function getNftAddress(address _boostingAddr) private view returns (address NFTAddress) {
        NFTAddress = IBoosting(_boostingAddr).NFTAddress();
    }

    function getBoostUserTokenId(address _boostingAddr, uint256 _pid, address _user) private view returns (uint256 tokenId) {
        (,,tokenId) = IBoosting(_boostingAddr).userInfo(_pid, _user);
    }

    function getPoolNftTokenId(uint256 _pid, address _boostingAddr) private view returns (uint256 oldNftTokenId) {
        oldNftTokenId = getBoostUserTokenId(_boostingAddr, _pid, address(this));
    }

}
