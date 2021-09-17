// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract AgentStorage {
    using SafeMath for uint256;
    // The sc address for ZOOKeeperFarming!
    address public zooKeeperFarming;
    // sc address for dual farming
    address public wanswapFarming;
    // the reward token for dual farming
    address public zoo;
    // the reward token for dual farming
    address public wasp;
    // Dev address.
    address public devaddr;
    // boosting controller contract address
    address public boostingAddr;
    // help contract address
    address public helpAddr;
    // Max multiplier
    uint256 public devZoo;

    // Info of each pool.
    struct AgentPool {
        uint256 lastRewardBlock;  // Last block number that ZOOs distribution occurs.

        uint256 accZooPerShare;   // Accumulated ZOOs per share, times 1e12. See below.
        uint256 nftUserZooReward;        // Accumulated ZOOs per share, times 1e12. See below.

        // extra pool reward
        // uint256 waspPid;         // PID for extra pool
        uint256 accWaspPerShare; // Accumulated extra token per share, times 1e12.

        uint256 nftTokenId;         // token id of pool nft.
        address nftOwner;         // Address of nft token user.
        IERC20 lpToken;          // Address of LP token contract.

        bool dualFarmingEnable;
        bool emergencyMode;
        bool disable;
    }

    mapping(uint256 => AgentPool) public agentPool;

    // Info of each user.
    struct UserInfo {
        uint256 amount;     // How many LP tokens the user has provided.
        uint256 zooRewardDebt; // extra reward debt for zoo
        uint256 waspRewardDebt; // extra reward debt for wasp
        //
        // We do some fancy math here. Basically, any point in time, the amount of ZOOs
        // entitled to a user but is pending to be distributed is:
        //
        //   pending reward = (user.amount * pool.accZooPerShare) - user.zooRewardDebt
        //
        // Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
        //   1. The pool's `accZooPerShare` (and `lastRewardBlock`) gets updated.
        //   2. User receives the pending reward sent to his/her address.
        //   3. User's `amount` gets updated.
        //   4. User's `zooRewardDebt` gets updated.
    }
    // Info of each user that stakes LP tokens.
    mapping (uint256 => mapping (address => UserInfo)) public userInfo;

    // Total allocation poitns. Must be the sum of all allocation points in all pools.

    uint256 public constant TEAM_PERCENT = 25;
    uint256 public constant NFT_PERCENT = 25;
    uint256 public constant LP_PERCENT = 50;
    uint256 public constant DENOMINATOR = 100;
}
