// edited
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// OpenZeppelin Imports
import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol"; // TODO: solady
import { Utils } from './common/Utils.sol';

// ERC-6551 Imports
import { IAccountImplementation } from "./interfaces/TBABoilerplate/IAccountImplementation.sol";
import { IAccountProxy } from "./interfaces/TBABoilerplate/IAccountProxy.sol";
import { IRegistry } from  "./interfaces/TBABoilerplate/IRegistry.sol";

// Renderers
import { BodyRenderer } from './renderers/BodyRenderer.sol';
import { TraitsRenderer } from './renderers/TraitsRenderer.sol';
import { RenderHelper } from "./renderers/RenderHelper.sol";

// The Traits ERC-721 Contract
import { PeterTraits } from "./PeterTraits.sol";

// Associated Interfaces and Libraries
import { IPeterStorage } from './interfaces/IPeterStorage.sol';
import { ITraitStorage } from './interfaces/ITraitStorage.sol';
import { TraitCategory } from './TraitCategory.sol';

import "forge-std/console.sol"; // DEPLOY: remove

contract PetersMain is IPeterStorage, ERC721, Ownable {

    error IncorrectPeterOwner();
    error IncorrectTBAOwner();
    error IncorrectTraitType();

    /// @dev We use this database for persistent storage.
    Peters peterTokens;

    /// The address of the ERC-721 Traits contract
    PeterTraits public traitsContract;

    // Renderers for the body and individual traits
    BodyRenderer public bodyRenderer;
    TraitsRenderer public traitsRenderer;

    uint256 _nextTokenId = 0;

    uint256 public price;

    // ERC-6551 Boilerplate addresses
    address constant ACCOUNT_PROXY = 0x55266d75D1a14E4572138116aF39863Ed6596E7F;
    address constant ACCOUNT_IMPLEMENTATION= 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC;
    IRegistry constant REGISTRY = IRegistry(0x000000006551c19487814612e58FE06813775758);

    string constant SVG_START = '<svg shape-rendering="crispEdges" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg"><style>rect{width:1px; height: 1px;} .bg{width:30px; height: 30px;} </style><rect class="bg" fill="#0D6E9D"/>';

    constructor() ERC721("Peter Test", "PETER") { // DEPLOY: remove all of this
        traitsContract = new PeterTraits();
        bodyRenderer = new BodyRenderer();
        traitsRenderer = new TraitsRenderer();

        // for (uint i; i < 3; ++i) { // DEPLOY: remove
        //     mint(); // Mints 3 bodies
        // }
    }

    function mint() public { // TODO: payable, amount, check price
        uint256 tokenId = ++_nextTokenId;
        _mint(msg.sender, tokenId);

        // params: implementation address, salt, chainId, tokenContract, tokenId
        address tokenBoundAccountAddress = REGISTRY.createAccount(
            ACCOUNT_PROXY,
            0,
            84532, // 31337 for local deployment // chainId (8453 for Base), chainId (84532 for Base Sepolia), chain Id 11155111 for Sepolia
            address(this),
            tokenId
        );

        // initialize : use this address as the implementation parameter when calling initialize on a newly created account
        IAccountProxy(payable(tokenBoundAccountAddress)).initialize(address(ACCOUNT_IMPLEMENTATION));

        // uint256[] memory traitsIds = traits.safeMint(address(this)); // fine if minting to this address
        uint256[] memory traitsIds = traitsContract.safeMint(tokenBoundAccountAddress); // fails if minting to TBA

        // Initialize our Peter
        StoredPeter storage peter = peterTokens.all[tokenId];

        peter.tokenId = tokenId;
        peter.shirtId = traitsIds[0]; // shirtId is a trait contract token id
        peter.pantsId = traitsIds[1]; // same with pants id
    }

    /// Equip/Unequip clothing traits

    // TODO | TBD
    function equipShirt(uint256 _peterTokenId, uint256 _traitTokenId) public {
        _validateTokenOwnership(_peterTokenId, _traitTokenId, msg.sender);
        _validateTrait(_traitTokenId, TraitCategory.Name.Shirt);

        peterTokens.all[_peterTokenId].shirtId = _traitTokenId;
    }

    function unequipShirt(uint256 _peterTokenId) public {
        peterTokens.all[_peterTokenId].shirtId = 0;
    }

    // Might want counterpart view functions that just compile the svg without writing to chain
    function equipPants(uint256 _peterTokenId, uint256 _traitTokenId) public {
        _validateTokenOwnership(_peterTokenId, _traitTokenId, msg.sender);
        _validateTrait(_traitTokenId, TraitCategory.Name.Pants);

        peterTokens.all[_peterTokenId].pantsId = _traitTokenId;
    }

    function unequipPants(uint256 _peterTokenId) public {
        peterTokens.all[_peterTokenId].pantsId = 0;
    }

    function unequipAll(uint256 _peterTokenId) public {
        // peterTokens.all[_peterTokenId].hatId = 0;
        // peterTokens.all[_peterTokenId].hairId = 0;
        // peterTokens.all[_peterTokenId].glassesId = 0;
        // peterTokens.all[_peterTokenId].handheldId = 0;
        peterTokens.all[_peterTokenId].shirtId = 0;
        peterTokens.all[_peterTokenId].pantsId = 0;
        // peterTokens.all[_peterTokenId].shoesId = 0;
    }

    // If 0, it will ignore
    function equipAll(uint256 _peterTokenId, uint256 _shirtTokenId, uint256 _pantsTokenId) public {
        // TODO: do this for other traits

        if (_shirtTokenId != 0) equipShirt(_peterTokenId, _shirtTokenId);
        if (_pantsTokenId != 0) equipPants(_peterTokenId, _pantsTokenId);

        // TODO: do this for the other traits
    }

    /// Validations

    function _validateTokenOwnership(uint _peterId, uint _traitTokenId, address _msgSender) internal view {
        address peterOwner = ownerOf(_peterId);
        if (_msgSender != peterOwner) revert IncorrectPeterOwner(); // Not your Peter

        address tbaOfTokenIdToBeSet = traitsContract.ownerOf(_traitTokenId);
        address ownerOfTBA = IAccountImplementation(payable(tbaOfTokenIdToBeSet)).owner();

        if (ownerOfTBA != peterOwner) revert IncorrectTBAOwner();
    }

    // TODO: modifiers for ownership
    function _validateTrait(uint256 _traitTokenId, TraitCategory.Name _traitType) internal view {
        TraitCategory.Name traitTypeofTokenIdToBeSet = traitsContract.getTraitType(_traitTokenId); // Hat, Pants, etc.

        // Checks the fetched TraitCategory.Name against the one we send in
        if (keccak256(abi.encodePacked(uint(traitTypeofTokenIdToBeSet))) != keccak256(abi.encodePacked(uint(_traitType))))
            revert IncorrectTraitType();
    }

    /// tokenURI/Rendering

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        // _requireOwned(tokenId); // todo: put this back in?

        return renderAsDataUri(tokenId);
    }

    function renderAsDataUri(uint256 _tokenId) public view returns (string memory) {
        string memory bodySvg;
        string memory traitsSvg;
        string memory fullSvg;
        string memory bodyAttributes;
        string memory traitAttributes;
        string memory fullAttributes;

        Peter memory peter = getPeter(_tokenId);

        (bodySvg, bodyAttributes) = bodyRenderer.getSVG(peter.stored);

        string memory shirtName = traitsContract.tokenIdToMetadataString(peter.stored.shirtId);
        string memory pantsName = traitsContract.tokenIdToMetadataString(peter.stored.pantsId);

        (, , string memory shirtSvg) = traitsContract.traitNameToMetadata(shirtName);
        (, , string memory pantsSvg) = traitsContract.traitNameToMetadata(pantsName);

        /*
        // this is how we would get the Trait Metadata but i'm getting a stack too deep error when doing this

        (, TraitCategory.Name shirtType, string memory shirtSvg) = traitsContract.traitNameToMetadata(shirtName);
        (, TraitCategory.Name pantsType , string memory pantsSvg) = traitsContract.traitNameToMetadata(pantsName);

        string memory shirtTraitTypeString = TraitCategory.toString(shirtType);
        traitAttributes = string.concat( RenderHelper.stringTrait('Shirt', shirtTraitTypeString), RenderHelper.stringTrait('Pants', pantsTraitTypeString));
        */

        // Combine the traits
        // NOTE: here we can add an svg path for something that isn't equipped (ie and empty string and it shouldnt affect the render)
        traitsSvg = string.concat(
            shirtSvg,
            pantsSvg
        );

        // fullAttributes = string.concat('"attributes":[', bodyAttributes, ',', traitAttributes, ']');
        fullAttributes = string.concat('"attributes":[', bodyAttributes, ']');
        console.log('fullAttributes:', fullAttributes);

        fullSvg = string.concat(
            SVG_START,
            bodySvg,
            traitsSvg,
            '</svg>'
        );

        string memory image = string.concat(
            '"image":"data:image/svg+xml;base64,',
            Utils.encode(bytes(fullSvg)),
            '"'
        );

        string memory json = string.concat(
            '{"name":"Peter #',
                Utils.toString(_tokenId),
             '","description": "This is just a test",',
                fullAttributes,
            ',',
                image,
            '}'
        );

        return string.concat("data:application/json;base64,", Utils.encode(bytes(json)));
    }

    /// Getters

    function getPeter(uint256 tokenId) public view returns (IPeterStorage.Peter memory) {
        IPeterStorage.Peter memory peter;
        peter.stored = peterTokens.all[tokenId];
        return peter;
    }

    // Only Owner
    // TODO: PUT BACK IN
    /*
    function setTraitsContract(address _address) public onlyOwner {
        traitsContract = PeterTraits(_address);
    }

    function setBodyRenderer(address _address) public onlyOwner {
        bodyRenderer = BodyRenderer(_address);
    }

    function setTraitsRenderer(address _address) public onlyOwner {
        traitsRenderer = TraitsRenderer(_address);
    }

    function setPrice(uint256 _priceInWei) public onlyOwner {
        price = _priceInWei;
    }

    */

    // Boilerplate

    function supportsInterface(bytes4 interfaceId) public view override(ERC721) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    // // Is this right?
    // function _beforeTokenTransfer(address from, address to, uint256 tokenId) internal override(ERC721Enumerable) {
    //     super._beforeTokenTransfer(from, to, tokenId);
    // }

    // TODO: Withdraw function
}
