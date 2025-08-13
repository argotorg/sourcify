pragma solidity ^0.4.0;

contract Simple {
    uint public value;
    
    function Simple() {
        value = 42;
    }
    
    function setValue(uint _value) {
        value = _value;
    }
}