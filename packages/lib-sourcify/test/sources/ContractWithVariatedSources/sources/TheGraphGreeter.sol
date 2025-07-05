// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

contract TheGraphGreeter
{
    string public greeting;
    event Greeted(string hello, address sender);

    function greet(string memory greeting_) public
    {
        greeting = greeting_;
        emit Greeted(greeting, msg.sender);
    }
}