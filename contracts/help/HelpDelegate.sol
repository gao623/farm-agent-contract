// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

contract HelpDelegate {

    function isValidNftTokenId(uint256 _nftTokenId) external pure returns (bool) {
      return _nftTokenId != nilTokenId();
    }

    function nilTokenId() public pure returns (uint) {
      return 0;
    }
}
