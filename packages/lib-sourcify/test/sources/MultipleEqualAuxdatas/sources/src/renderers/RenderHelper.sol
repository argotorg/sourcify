// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { Utils } from '../common/Utils.sol';
import { Random, RandomCtx } from '../common/Random.sol';

library RenderHelper {

    enum Body {
        BODY_001,
        BODY_002,
        BODY_003
    }

    enum Hair {
        HAIR_001,
        HAIR_002,
        HAIR_003
    }

    enum Shirt {
        SHIRT_001,
        SHIRT_002,
        SHIRT_003
    }

    enum Pants {
        PANTS_001,
        PANTS_002,
        PANTS_003
    }

    enum Shoes {
        SHOES_001,
        SHOES_002,
        SHOES_003
    }

    struct TraitsInfo {
        Body body;
        // Hair hair;
        Shirt shirt;
        Pants pants;
        Shoes shoes;
    }

    function toString(Body body) internal pure returns (string memory) {
        if (body == Body.BODY_002) return "Body 002";
        if (body == Body.BODY_003) return "Body 003";
        return "Body 001";
    }

    function toString(Hair hair) internal pure returns (string memory) {
        if (hair == Hair.HAIR_002) return "Hair 002";
        // if (hair == Hair.HAIR_003) return "Hair 003";
        return "Hair 001";
    }

    function toString(Shirt shirt) internal pure returns (string memory) {
        if (shirt == Shirt.SHIRT_002) return "Shirt 002";
        // if (shirt == Shirt.SHIRT_003) return "Shirt 003";
        return "Shirt 001";
    }

    function toString(Pants pants) internal pure returns (string memory) {
        if (pants == Pants.PANTS_002) return "Pants 002";
        // if (pants == Pants.PANTS_003) return "Pants 003";
        return "Pants 001";
    }

    function toString(Shoes shoes) internal pure returns (string memory) {
        if (shoes == Shoes.SHOES_002) return "Shoes 002";
        // if (shoes == Shoes.SHOES_003) return "Shoes 003";
        return "Shoes 001";
    }

    function randomTraits(RandomCtx memory rndCtx) internal pure returns (TraitsInfo memory) {
        TraitsInfo memory traits = TraitsInfo({
            body: Body(Random.randWithProbabilities(rndCtx, Random.probabilityArray(50, 50))),
            shirt: Shirt(Random.randWithProbabilities(rndCtx, Random.probabilityArray(50, 50))),
            // hair: Hair(Random.randWithProbabilities(rndCtx, Random.probabilityArray(50, 50))),
            pants: Pants(Random.randWithProbabilities(rndCtx, Random.probabilityArray(50, 50))),
            shoes: Shoes(Random.randWithProbabilities(rndCtx, Random.probabilityArray(50, 50)))
        });

        return traits;
    }

    function randomBody(RandomCtx memory rndCtx) internal pure returns (string memory) {
        Body body = Body(Random.randWithProbabilities(rndCtx, Random.probabilityArray(50, 50)));

        return toString(body);
    }

    function randomShirt(RandomCtx memory rndCtx) internal pure returns (string memory) {
        Shirt shirt = Shirt(Random.randWithProbabilities(rndCtx, Random.probabilityArray(50, 50)));

        return toString(shirt);
    }

    function randomPants(RandomCtx memory rndCtx) internal pure returns (string memory) {
        Pants pants = Pants(Random.randWithProbabilities(rndCtx, Random.probabilityArray(50, 50)));

        return toString(pants);
    }

    function randomShoes(RandomCtx memory rndCtx) internal pure returns (string memory) {
        Shoes shoes = Shoes(Random.randWithProbabilities(rndCtx, Random.probabilityArray(50, 50)));

        return toString(shoes);
    }

    function getTraitsAsJson(TraitsInfo memory traits) internal pure returns (string memory) {
        string memory result = string.concat(
            stringTrait("Body", toString(traits.body)), ',',
            // stringTrait("Hair", toString(traits.hair)), ',',
            stringTrait("Shirt", toString(traits.shirt)), ',',
            stringTrait("Pants", toString(traits.pants))
            // stringTrait("Shoes", toString(traits.shoes))
        );

        return string.concat('"attributes":[', result, ']');
    }

    function getTraitAsJson(string memory traitName, string memory traitValue) internal pure returns (string memory) {
        string memory result = string.concat(
            stringTrait(traitName,traitValue)
        );

        return string.concat(
            '"attributes":[',
                result,
            ']'
        );
    }

    function stringTrait(string memory traitName, string memory traitValue) internal pure returns (string memory) {
        return string.concat(
            '{"trait_type":"',
                traitName,
            '","value":"',
                traitValue,
            '"}'
        );
    }

}
