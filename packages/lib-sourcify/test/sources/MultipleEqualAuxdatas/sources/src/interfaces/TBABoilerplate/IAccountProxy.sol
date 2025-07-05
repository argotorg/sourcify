// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

interface IAccountProxy {
    function initialize(address _implementation) external;
}
