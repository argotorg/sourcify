// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

library Utils {
    uint256 internal constant MULTIPLIER   = 100;
    uint256 internal constant GOLDEN_RATIO = 161803;

    /**
      * Compute the largest integer smaller than or equal to the square root of `n`
    */
    // function floorSqrt(uint256 n) internal pure returns (uint256) { unchecked {
    //     if (n > 0) {
    //         uint256 x = n / 2 + 1;
    //         uint256 y = (x + n / x) / 2;
    //         while (x > y) {
    //             x = y;
    //             y = (x + n / x) / 2;
    //         }
    //         return x;
    //     }
    //     return 0;
    // }}

    /**
      * Compute the smallest integer larger than or equal to the square root of `n`
    */
    // function ceilSqrt(uint256 n) internal pure returns (uint256) { unchecked {
    //     uint256 x = floorSqrt(n);
    //     return x ** 2 == n ? x : x + 1;
    // }}

    // function lerp(int256 targetFrom, int256 targetTo, int256 currentFrom, int256 currentTo, int current) internal pure returns (int256) { unchecked {
    //     int256 t = 0;a
    //     int256 divisor = currentTo - currentFrom - 1;

    //     if (divisor > 0) {
    //         t = (current - currentFrom) * int256(MULTIPLIER) / (divisor);
    //     }

    //     return targetFrom * int256(MULTIPLIER) + t * (targetTo - targetFrom);
    // }}

    function toByteArray(bytes32 _bytes32) internal pure returns (bytes memory result) {
        uint8 i = 0;
        while(i < 32 && _bytes32[i] != 0) {
            i++;
        }
        bytes memory bytesArray = new bytes(i);
        for (i = 0; i < 32 && _bytes32[i] != 0; i++) {
            bytesArray[i] = _bytes32[i];
        }
        return bytesArray;
    }

    function toString(bytes32 _bytes32) internal pure returns (string memory result) {
        return string(toByteArray(_bytes32));
    }

    // todo: check this
    function toStringBytes3(bytes3 _bytes) public pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory hexString = new bytes(6); // Since bytes3 contains 3 bytes, resulting in 6 hex characters

        for (uint i = 0; i < 3; i++) {
            hexString[i * 2] = hexChars[uint8(_bytes[i] >> 4)];
            hexString[1 + i * 2] = hexChars[uint8(_bytes[i] & 0x0f)];
        }

        return string(hexString);
    }


    /*

        Gas Efficient uint/int to string functions
        Copied from: https://github.com/Vectorized/solady/blob/main/src/utils/LibString.sol

    */

    /// @dev Returns the base 10 decimal representation of `value`.
    function toString(uint256 value) internal pure returns (string memory str) {
        /// @solidity memory-safe-assembly
        assembly {
            // The maximum value of a uint256 contains 78 digits (1 byte per digit), but
            // we allocate 0xa0 bytes to keep the free memory pointer 32-byte word aligned.
            // We will need 1 word for the trailing zeros padding, 1 word for the length,
            // and 3 words for a maximum of 78 digits.
            str := add(mload(0x40), 0x80)
            // Update the free memory pointer to allocate.
            mstore(0x40, add(str, 0x20))
            // Zeroize the slot after the string.
            mstore(str, 0)

            // Cache the end of the memory to calculate the length later.
            let end := str

            let w := not(0) // Tsk.
            // We write the string from rightmost digit to leftmost digit.
            // The following is essentially a do-while loop that also handles the zero case.
            for { let temp := value } 1 {} {
                str := add(str, w) // `sub(str, 1)`.
                // Write the character to the pointer.
                // The ASCII index of the '0' character is 48.
                mstore8(str, add(48, mod(temp, 10)))
                // Keep dividing `temp` until zero.
                temp := div(temp, 10)
                if iszero(temp) { break }
            }

            let length := sub(end, str)
            // Move the pointer 32 bytes leftwards to make room for the length.
            str := sub(str, 0x20)
            // Store the length.
            mstore(str, length)
        }
    }

    /// @dev Returns the base 10 decimal representation of `value`.
    function toString(int256 value) internal pure returns (string memory str) {
        if (value >= 0) {
            return toString(uint256(value));
        }
        unchecked {
            str = toString(uint256(-value));
        }
        /// @solidity memory-safe-assembly
        assembly {
            // We still have some spare memory space on the left,
            // as we have allocated 3 words (96 bytes) for up to 78 digits.
            let length := mload(str) // Load the string length.
            mstore(str, 0x2d) // Store the '-' character.
            str := sub(str, 1) // Move back the string pointer by a byte.
            mstore(str, add(length, 1)) // Update the string length.
        }
    }

     /// @dev Encodes `data` using the base64 encoding described in RFC 4648.
    /// See: https://datatracker.ietf.org/doc/html/rfc4648
    /// @param fileSafe  Whether to replace '+' with '-' and '/' with '_'.
    /// @param noPadding Whether to strip away the padding.
    function encode(bytes memory data, bool fileSafe, bool noPadding) internal pure returns (string memory result) {
        /// @solidity memory-safe-assembly
        assembly {
            let dataLength := mload(data)

            if dataLength {
                // Multiply by 4/3 rounded up.
                // The `shl(2, ...)` is equivalent to multiplying by 4.
                let encodedLength := shl(2, div(add(dataLength, 2), 3))

                // Set `result` to point to the start of the free memory.
                result := mload(0x40)

                // Store the table into the scratch space.
                // Offsetted by -1 byte so that the `mload` will load the character.
                // We will rewrite the free memory pointer at `0x40` later with
                // the allocated size.
                // The magic constant 0x0670 will turn "-_" into "+/".
                mstore(0x1f, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef")
                mstore(0x3f, xor("ghijklmnopqrstuvwxyz0123456789-_", mul(iszero(fileSafe), 0x0670)))

                // Skip the first slot, which stores the length.
                let ptr := add(result, 0x20)
                let end := add(ptr, encodedLength)

                // Run over the input, 3 bytes at a time.
                for {} 1 {} {
                    data := add(data, 3) // Advance 3 bytes.
                    let input := mload(data)

                    // Write 4 bytes. Optimized for fewer stack operations.
                    mstore8(0, mload(and(shr(18, input), 0x3F)))
                    mstore8(1, mload(and(shr(12, input), 0x3F)))
                    mstore8(2, mload(and(shr(6, input), 0x3F)))
                    mstore8(3, mload(and(input, 0x3F)))
                    mstore(ptr, mload(0x00))

                    ptr := add(ptr, 4) // Advance 4 bytes.
                    if iszero(lt(ptr, end)) { break }
                }
                mstore(0x40, add(end, 0x20)) // Allocate the memory.
                // Equivalent to `o = [0, 2, 1][dataLength % 3]`.
                let o := div(2, mod(dataLength, 3))
                // Offset `ptr` and pad with '='. We can simply write over the end.
                mstore(sub(ptr, o), shl(240, 0x3d3d))
                // Set `o` to zero if there is padding.
                o := mul(iszero(iszero(noPadding)), o)
                mstore(sub(ptr, o), 0) // Zeroize the slot after the string.
                mstore(result, sub(encodedLength, o)) // Store the length.
            }
        }
    }

    /// @dev Encodes `data` using the base64 encoding described in RFC 4648.
    /// Equivalent to `encode(data, false, false)`.
    function encode(bytes memory data) internal pure returns (string memory result) {
        result = encode(data, false, false);
    }

    /// @dev Encodes `data` using the base64 encoding described in RFC 4648.
    /// Equivalent to `encode(data, fileSafe, false)`.
    function encode(bytes memory data, bool fileSafe) internal pure returns (string memory result) {
        result = encode(data, fileSafe, false);
    }




    // /// @dev Returns a concatenated string of `a` and `b`.
    // /// Cheaper than `string.concat()` and does not de-align the free memory pointer.
    // function concat(string memory a, string memory b)
    //     internal
    //     pure
    //     returns (string memory result)
    // {
    //     /// @solidity memory-safe-assembly
    //     assembly {
    //         let w := not(0x1f)
    //         result := mload(0x40)
    //         let aLength := mload(a)
    //         // Copy `a` one word at a time, backwards.
    //         for { let o := and(add(aLength, 0x20), w) } 1 {} {
    //             mstore(add(result, o), mload(add(a, o)))
    //             o := add(o, w) // `sub(o, 0x20)`.
    //             if iszero(o) { break }
    //         }
    //         let bLength := mload(b)
    //         let output := add(result, aLength)
    //         // Copy `b` one word at a time, backwards.
    //         for { let o := and(add(bLength, 0x20), w) } 1 {} {
    //             mstore(add(output, o), mload(add(b, o)))
    //             o := add(o, w) // `sub(o, 0x20)`.
    //             if iszero(o) { break }
    //         }
    //         let totalLength := add(aLength, bLength)
    //         let last := add(add(result, 0x20), totalLength)
    //         // Zeroize the slot after the string.
    //         mstore(last, 0)
    //         // Stores the length.
    //         mstore(result, totalLength)
    //         // Allocate memory for the length and the bytes,
    //         // rounded up to a multiple of 32.
    //         mstore(0x40, and(add(last, 0x1f), w))
    //     }
    // }
}
