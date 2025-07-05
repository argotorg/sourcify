// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

library TraitCategory {

    // TODO: add bg as a trait?
    enum Name {
        Hat, // 0
        Hair, // 1
        Glasses, // 2
        Handheld, // 3
        Shirt, // 4
        Pants, // 5
        Shoes // 6
    }

    function toString(Name name) public pure returns (string memory) {
        if (name == Name.Hat) return "Hat";
        if (name == Name.Hair) return "Hair";
        if (name == Name.Glasses) return "Glasses";
        if (name == Name.Handheld) return "Handheld";
        if (name == Name.Shirt) return "Shirt";
        if (name == Name.Pants) return "Pants";
        if (name == Name.Shoes) return "Shoes";
        return "";
    }

}
