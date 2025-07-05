// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./Utils.sol";

library Division {

    using Utils for int256;

    function division(uint8 decimalPlaces, int256 numerator, int256 denominator) pure internal returns(int256 quotient, int256 remainder, string memory result) { unchecked {
        int256 factor = int256(10**decimalPlaces);
        quotient  = numerator / denominator;
        bool rounding = 2 * ((numerator * factor) % denominator) >= denominator;
        remainder = (numerator * factor / denominator) % factor;
        if (rounding) {
            remainder += 1;
        }
        result = string(abi.encodePacked(quotient.toString(), '.', numToFixedLengthStr(decimalPlaces, remainder)));
    }}

    function divisionStr(uint8 decimalPlaces, int256 numerator, int256 denominator) pure internal returns(string memory) {
        string memory result;
        (,,result) = division(decimalPlaces, numerator, denominator);
        return result;
    }

    function numToFixedLengthStr(uint256 decimalPlaces, int256 num) pure internal returns(string memory result) { unchecked {
        bytes memory byteString;
        for (uint256 i = 0; i < decimalPlaces; i++) {
            int256 remainder = num % 10;
            byteString = abi.encodePacked(remainder.toString(), byteString);
            num = num/10;
        }
        result = string(byteString);
    }}

}
