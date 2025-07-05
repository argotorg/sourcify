// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.6.0;

import "./Escrow.sol";
import "./provableAPI_0.6.sol";
import "./Owned.sol";
import "./Savings.sol";

contract Main is Owned, usingProvable{
    
    Escrow escrow;
    Savings fundsSaver;
    
    mapping (address => uint256) accountTarget;
    mapping (address => uint256) targetAchieved;
    mapping (address => bool) targetStatus; // {false: close/stop, true: open/running}
    mapping (bytes32 => address) awaitedQuery;
    
    constructor() public payable{
        require(msg.value >= 0.5 ether);
    }
    
    function setAddresses(address payable _escrowAddress, address _savingsAddress) public onlyOwner{
        escrow = Escrow(_escrowAddress);
        fundsSaver = Savings(_savingsAddress);
    }
    
    function setTarget(uint256 _target) external payable{
        require(accountTarget[msg.sender] == 0, "Not allowed: you already have a running target");
        accountTarget[msg.sender] = _target;
        // send received payment to Escrow
        escrow.addPayment{value:msg.value}(msg.sender);
        // make an oraclize query
        initiateProvableQuery();
    }
    
    function initiateProvableQuery() public {
       awaitedQuery[provable_query(10 minutes, "URL", "")] = msg.sender;
    }
    
    function __callback(bytes32 myid, string memory result) public override {
        if (msg.sender != provable_cbAddress()) revert();
        // after 10 minutes
        // ask for payment from escrow of the payer (who is initiator of the query)
        escrow.requestPayment(awaitedQuery[myid]);
    }
    
    function receivePayment(address _of) public payable{
        require(msg.sender == address(escrow));
        // receive payment of the the address passed in args _of
        // sends the payment to the savings Account
        fundsSaver.saveFunds{value:msg.value}(_of);
        
        // add the received savings to the targetAchieved
        targetAchieved[_of] += msg.value;
        
        // check if we have achieved the set target?
        
        if(targetAchieved[_of] != accountTarget[_of] && msg.value > 0){
            // send another provable query
            initiateProvableQuery();
        }
    }
    
    function isTargetReached() public view returns(bool) {
        if(targetAchieved[msg.sender] == accountTarget[msg.sender])
            return true;
        else
            return false;
    }
    
    function stopMyRequest(address payable _achievedTargetCollector) public {
        // checks if accountTarget is not zero
        require(accountTarget[msg.sender] != 0, "not exisiting target");
        targetStatus[msg.sender] = false;
        
        // request payment refund from savings
        fundsSaver.withdrawFunds(msg.sender, _achievedTargetCollector);
    }
    
    function withdrawTargetFromSavings(address _of, address payable _achievedTargetCollector) public payable{
        require(msg.sender == address(fundsSaver));
        
        // send the achieved target to the address passed in args _achievedTargetCollector
        _achievedTargetCollector.transfer(msg.value);
        
        // make the target achieved and target set to zero
        accountTarget[_of] = 0;
        targetAchieved[_of] = 0;
    }
    
    function balance() public view returns(uint256){
        return (address(this).balance);
    }
    
    fallback() external payable{
        require(msg.value >= 0.5 ether);
    }
}