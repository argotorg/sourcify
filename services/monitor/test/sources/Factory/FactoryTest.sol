// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.17;

contract Factory {
    address[] public childAddresses;
    event Deployment(address contractAddress);  

    function deploy(
        uint _foo
    ) public {
        address deployedAddress = address(new TestContract(_foo));
        emit Deployment(deployedAddress);
        childAddresses.push(deployedAddress);
    }
}

contract TestContract {
    uint public immutable foo;

    constructor(uint _foo) payable {
        foo = _foo;
    }

    function getFoo() public view returns (uint) {
        return foo;
    }
}

