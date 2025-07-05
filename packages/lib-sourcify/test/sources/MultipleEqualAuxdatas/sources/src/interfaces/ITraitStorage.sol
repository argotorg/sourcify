// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { TraitCategory } from '../TraitCategory.sol';

interface ITraitStorage {

    struct Traits {
        mapping(uint256 => StoredTrait) all;
    }

     struct Trait {
        StoredTrait stored;
     }

    struct StoredTrait {
        uint256 tokenId; // probs don't need this
        TraitCategory.Name traitType; // e.g. Shirt // TODO: rename to category
        string traitName; // e.g. Hoodie Black
        // string traitPath; // e.g. the svg code minus the top and bottom svg tags | TODO
    }

    struct TraitMetadata {
        string traitName; // e.g. 'Blue Shirt', same as key, redundant for now
        TraitCategory.Name traitType; // e.g. TraitCategory.Name.Shirt
        string traitPath; // e.g. the svg code minus the top and bottom svg tags
        // maybe a property in here for the attributes array values
    }

}
