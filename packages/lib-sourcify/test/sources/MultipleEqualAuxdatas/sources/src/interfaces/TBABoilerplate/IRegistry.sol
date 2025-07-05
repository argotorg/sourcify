// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IRegistry {

    // function symbolScheme(uint256 index) external view returns (uint8);

    // function tokenURI(uint256 index) external view returns (string memory);

    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external returns (address);

    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external view returns (address);

}
