// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.6.0;
import "./Main.sol";

contract Savings {
    
    Main main;
    mapping(address => uint256) accountSavings;
    
    constructor(address payable _main) public {
        main = Main(_main);
    }
    
    // saves funds of the address passed in _of
    function saveFunds(address _of) public payable{
        require(msg.sender == address(main));
        accountSavings[_of] += msg.value;
    }
    
    function withdrawFunds(address _of, address payable _achievedTargetCollector) public payable{
        require(msg.sender == address(main));
        main.withdrawTargetFromSavings{value: accountSavings[_of]}(_of, _achievedTargetCollector);
        accountSavings[_of] = 0;
    }
    
    function balance() public view returns(uint256){
        return (address(this).balance);
    }
}