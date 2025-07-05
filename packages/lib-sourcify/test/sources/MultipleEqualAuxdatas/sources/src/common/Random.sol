// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "./Division.sol";
import "./RandomCtx.sol";

library Random {
    function initCtx(uint256 startingSeed) internal pure returns (RandomCtx memory) {
        // some 10 digit prime numbers
        // 1024243321, 1024383257, 1028910301, 1111111231, 1111211111
        // 1317313771, 1500000001, 2999999929, 3333323333, 4332221111
        // 5111111191, 6668999101, 7000000001, 8018018081, 9199999999
        return RandomCtx(startingSeed, 5111111191 * startingSeed);
    }

    function setSeed(RandomCtx memory ctx, uint256 startingSeed) internal pure {
        ctx.seed = startingSeed;
    }

    // function setSeedFromConract(RandomCtx memory ctx, uint256 startingSeed) internal view {
    //     ctx.seed = uint256(keccak256(
    //         abi.encode(
    //             startingSeed,
    //             blockhash(block.number - 1),
    //             block.coinbase,
    //             block.prevrandao,
    //             block.timestamp
    //         )
    //     ));
    // }

    function randInt(RandomCtx memory ctx) internal pure returns (uint256) {
        ctx.counter++;

        ctx.seed = uint256(keccak256(
            abi.encode(
                ctx.seed, ctx.counter
            )
        ));

        return ctx.seed;
    }

    function randUInt32(RandomCtx memory ctx) internal pure returns (uint32) {
        return uint32(int32(randRange(ctx, 0, 2147483647))); // positive only to accomodate SEED in SVG
    }

    function randFloat(RandomCtx memory ctx, uint8 decimalPlaces, int256 from, int256 to, int256 denominator) internal pure returns (string memory result) {
        int256 rInt = randRange(ctx, from, to);
        result = Division.divisionStr(decimalPlaces, rInt, denominator);
    }

    function randWithProbabilities(RandomCtx memory ctx, bytes memory probabilities) internal pure returns (uint8) { unchecked {
        uint256 probSum = 0;

        for (uint8 i = 0; i < probabilities.length; i++) {
            probSum += uint256(uint8(probabilities[i]));
        }

        int256 rnd = Random.randRange(ctx, 1, int256(probSum));

        probSum = 0;
        for (uint8 i = 0; i < probabilities.length; i++) {
            probSum += uint256(uint8(probabilities[i]));

            if (int256(probSum) >= rnd) {
                return i;
            }
        }

        return 0;
    }}

    function randRange(RandomCtx memory ctx, int256 from, int256 to) internal pure returns (int256) { unchecked {
        if (from > to) {
            to = from;
        }
        uint256 rnd = randInt(ctx);

        return from + int256(rnd >> 1) % (to - from + 1);
    }}

    /**
     *
     * @param ctx - context
     * @param minusProbability - 0 to 100 percents
     */
    function randSign(RandomCtx memory ctx, int256 minusProbability) internal pure returns (int256) {
        if (randRange(ctx, 1, 100) <= minusProbability) {
            return -1;
        }
        return 1;
    }


    /**
     *
     * @param ctx - context
     * @param trueProbability - 0 to 100 percents
     */
    function randBool(RandomCtx memory ctx, int256 trueProbability) internal pure returns (bool) {
        return (randRange(ctx, 1, 100) <= trueProbability);
    }

    function randWithProbabilities(RandomCtx memory ctx, uint16[] memory probabilities) internal pure returns (uint8) { unchecked {
        uint probSum = 0;

        for (uint8 i = 0; i < probabilities.length; i++) {
            probSum += uint(probabilities[i]);
        }

        int rnd = Random.randRange(ctx, 1, int(probSum));

        probSum = 0;
        for (uint8 i = 0; i < probabilities.length; i++) {
            probSum += uint(probabilities[i]);

            if (int(probSum) >= rnd) {
                return i;
            }
        }

        return 0;
    }}

    function probabilityArray(uint16 a0, uint16 a1) internal pure returns (uint16[] memory) {
        uint16[] memory result = new uint16[](2);
        result[0] = a0;
        result[1] = a1;
        return result;
    }

    function probabilityArray(uint16 a0, uint16 a1, uint16 a2) internal pure returns (uint16[] memory) {
        uint16[] memory result = new uint16[](3);
        result[0] = a0;
        result[1] = a1;
        result[2] = a2;
        return result;
    }

    function probabilityArray(uint16 a0, uint16 a1, uint16 a2, uint16 a3) internal pure returns (uint16[] memory) {
        uint16[] memory result = new uint16[](4);
        result[0] = a0;
        result[1] = a1;
        result[2] = a2;
        result[3] = a3;
        return result;
    }

    function probabilityArray(uint16 a0, uint16 a1, uint16 a2, uint16 a3, uint16 a4) internal pure returns (uint16[] memory) {
        uint16[] memory result = new uint16[](5);
        result[0] = a0;
        result[1] = a1;
        result[2] = a2;
        result[3] = a3;
        result[4] = a4;
        return result;
    }


    function probabilityArray(uint16 a0, uint16 a1, uint16 a2, uint16 a3, uint16 a4, uint16 a5) internal pure returns (uint16[] memory) {
        uint16[] memory result = new uint16[](6);
        result[0] = a0;
        result[1] = a1;
        result[2] = a2;
        result[3] = a3;
        result[4] = a4;
        result[5] = a5;
        return result;
    }

    function probabilityArray(uint16 a0, uint16 a1, uint16 a2, uint16 a3, uint16 a4, uint16 a5, uint16 a6) internal pure returns (uint16[] memory) {
        uint16[] memory result = new uint16[](7);
        result[0] = a0;
        result[1] = a1;
        result[2] = a2;
        result[3] = a3;
        result[4] = a4;
        result[5] = a5;
        result[6] = a6;
        return result;
    }

    function probabilityArray(uint16 a0, uint16 a1, uint16 a2, uint16 a3, uint16 a4, uint16 a5, uint16 a6, uint16 a7) internal pure returns (uint16[] memory) {
        uint16[] memory result = new uint16[](8);
        result[0] = a0;
        result[1] = a1;
        result[2] = a2;
        result[3] = a3;
        result[4] = a4;
        result[5] = a5;
        result[6] = a6;
        result[7] = a7;
        return result;
    }

    function probabilityArray(uint16 a0, uint16 a1, uint16 a2, uint16 a3, uint16 a4, uint16 a5, uint16 a6, uint16 a7, uint16 a8) internal pure returns (uint16[] memory) {
        uint16[] memory result = new uint16[](9);
        result[0] = a0;
        result[1] = a1;
        result[2] = a2;
        result[3] = a3;
        result[4] = a4;
        result[5] = a5;
        result[6] = a6;
        result[7] = a7;
        result[8] = a8;
        return result;
    }

    function probabilityArray(uint16 a0, uint16 a1, uint16 a2, uint16 a3, uint16 a4, uint16 a5, uint16 a6, uint16 a7, uint16 a8, uint16 a9) internal pure returns (uint16[] memory) {
        uint16[] memory result = new uint16[](10);
        result[0] = a0;
        result[1] = a1;
        result[2] = a2;
        result[3] = a3;
        result[4] = a4;
        result[5] = a5;
        result[6] = a6;
        result[7] = a7;
        result[8] = a8;
        result[9] = a9;
        return result;
    }

    function probabilityArray(uint16 a0, uint16 a1, uint16 a2, uint16 a3, uint16 a4, uint16 a5, uint16 a6, uint16 a7, uint16 a8, uint16 a9, uint16 a10) internal pure returns (uint16[] memory) {
        uint16[] memory result = new uint16[](11);
        result[0] = a0;
        result[1] = a1;
        result[2] = a2;
        result[3] = a3;
        result[4] = a4;
        result[5] = a5;
        result[6] = a6;
        result[7] = a7;
        result[8] = a8;
        result[9] = a9;
        result[10] = a10;
        return result;
    }

    function probabilityArray(uint16 a0, uint16 a1, uint16 a2, uint16 a3, uint16 a4, uint16 a5, uint16 a6, uint16 a7, uint16 a8, uint16 a9, uint16 a10, uint16 a11, uint16 a12) internal pure returns (uint16[] memory) {
        uint16[] memory result = new uint16[](13);
        result[0] = a0;
        result[1] = a1;
        result[2] = a2;
        result[3] = a3;
        result[4] = a4;
        result[5] = a5;
        result[6] = a6;
        result[7] = a7;
        result[8] = a8;
        result[9] = a9;
        result[10] = a10;
        result[11] = a11;
        result[12] = a12;
        return result;
    }
}
