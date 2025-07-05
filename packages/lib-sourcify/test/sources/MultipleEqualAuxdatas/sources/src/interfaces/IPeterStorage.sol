// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

/// A shared interface for data storage of the Peter
interface IPeterStorage {

    // Token id => Peter
    struct Peters {
        mapping(uint256  => StoredPeter) all;
    }

    // An individual Peter
    struct Peter {
        StoredPeter stored;
    }

    // The token id in the traits contract of each corresponding trait to be layered on the Peter from the PeterTraits contract
    struct StoredPeter {
        uint256 tokenId;
        // uint256 hatId;
        // uint256 hairId;
        // uint256 glassesId;
        // uint256 handheldId;
        uint256 shirtId;
        uint256 pantsId;
        // uint256 shoesId;
    }

}
