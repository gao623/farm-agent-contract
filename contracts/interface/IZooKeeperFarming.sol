// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IZooKeeperFarming {

    function wanswapFarming()  external view returns (address);
    function boostingAddr()  external view returns (address);
    function wasp()  external view returns (address);
    function zoo()  external view returns (address);
    function zooPerBlock()  external view returns (uint256);
    function totalAllocPoint()  external view returns (uint256);
    function maxMultiplier()  external view returns (uint256);
    function getMultiplier(uint256 _from, uint256 _to) external view returns (uint256);

    function poolInfo(uint256 pid) external view returns (address lpToken, uint256 allocPoint, uint256 lastRewardBlock, uint256 accZooPerShare, uint256 waspPid, uint256 accWaspPerShare, bool dualFarmingEnable, bool emergencyMode);

    function poolLength() external view returns (uint256);

    function userInfo(uint256 pid, address user) external view returns (uint256 amount, uint256 rewardDebt, uint256 waspRewardDebt);

    function pendingZoo(uint256 _pid, address _user) external view returns (uint256);

    function pendingWasp(uint256 _pid, address _user) external view returns (uint256);

    function deposit(uint256 _pid, uint256 _amount, uint lockTime, uint nftTokenId) external;

    function withdraw(uint256 _pid, uint256 _amount) external;

    function emergencyWithdraw(uint256 _pid) external;
}
