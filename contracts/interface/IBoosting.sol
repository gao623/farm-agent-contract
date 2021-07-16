// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IBoosting {
    function NFTAddress() external view returns (address NftAddress);

    function getMultiplier(uint _pid, address _user) external view returns (uint);

    function userInfo(uint256 _pid, address _user) external view returns (uint256 startTime, uint256 lockTime, uint256 tokenId);

    function poolInfo(uint256 _pid) external view returns (address lpToken, uint256 allocPoint, uint256 lastRewardBlock, uint256 accZooPerShare, uint256 waspPid, uint256 accWaspPerShare, bool dualFarmingEnable, bool emergencyMode);

    function poolLength(uint256 _pid) external view returns (uint256 length);

    function pendingZoo(uint256 _pid, address _user) external view returns (uint256 pendZoo);

    function pendingWasp(uint256 _pid, address _user) external view returns (uint256 pendWasp);

    function deposit(uint256 _pid, uint256 _amount) external;

    function withdraw(uint256 _pid, uint256 _amount) external;

    function emergencyWithdraw(uint256 _pid) external;
}
