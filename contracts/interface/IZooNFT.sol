// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

interface IZooNFT {
    // scaled 1e12
    function getBoosting(uint256 _tokenId) external view returns (uint256);
    // scaled 1e12
    function getLockTimeReduce(uint _tokenId) external view returns (uint);
}
