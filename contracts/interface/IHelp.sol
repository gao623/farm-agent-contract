// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IHelp {
    function isValidNftTokenId(uint256 _nftTokenId) external pure returns (bool);
    function nilTokenId() external pure returns (uint);
}
