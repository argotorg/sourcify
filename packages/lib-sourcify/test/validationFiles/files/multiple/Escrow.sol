// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.6.0;

import "./Main.sol";

contract Escrow{
    
    Main main;
    mapping(address => uint256) payerFunds;
    address payable escrowTaker;
    constructor(address payable _escrowTaker) public{
        escrowTaker = _escrowTaker;
        main = Main(_escrowTaker);
    }
    
    // receive ethers
    fallback() external payable{
        addPayment(msg.sender);
    }
    
    // receive ethers
    receive() external payable{
        addPayment(msg.sender);
    }
    
    // payment will be added for start
    // stored with the payer address
    function addPayment(address _payer) public payable{
        payerFunds[_payer] += msg.value;
    }
    
    // request payment
    function requestPayment(address _of) public{
        require(msg.sender == escrowTaker, "unauthorize");
        require(payerFunds[_of] > 0);
        main.receivePayment{value:payerFunds[_of]}(_of);
        payerFunds[_of] = 0;
    }
    
    function balance() public view returns(uint256){
        return (address(this).balance);
    }
}