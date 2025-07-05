// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

// OpenZeppelin Imports
import { ERC721 } from '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import { Ownable } from '@openzeppelin/contracts/access/Ownable.sol'; // TODO: solady
import { Utils } from './common/Utils.sol';

// Renderers
import { TraitsRenderer } from './renderers/TraitsRenderer.sol';
import { RenderHelper } from "./renderers/RenderHelper.sol";
import { BodyRenderer } from './renderers/BodyRenderer.sol';

// Associated Interfaces and Libraries
import { ITraitStorage } from './interfaces/ITraitStorage.sol';
import { TraitCategory } from './TraitCategory.sol';

import "forge-std/console.sol"; // DEPLOY: remove

// This may need enumerable, i dont think the other one does
contract PeterTraits is ERC721, ITraitStorage,  Ownable {

    BodyRenderer public bodyRenderer;

    /// @dev We use this database for persistent storage.
    Traits traits;

    string constant SVG_START = '<svg shape-rendering="crispEdges" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg"><style>rect{width:1px; height: 1px;} .bg{width:30px; height: 30px;} </style><rect class="bg" fill="#0D6E9D"/>';

    uint8 constant INITIAL_TRAIT_NUMBER = 2;

    address public minter;

    // An address that will be used to sign newly incoming traits
    address public signer;

    uint256 public totalSupply; // DEPLOY: I think we get this for free from ERC721, can prob remove

    TraitsRenderer public traitsRenderer;

    // ShirtType to SVG code
    mapping(string => string) shirtTypeToSVG;

    // PantType to SVG code
    mapping(string => string) pantsTypeToSVG;

    mapping(uint256 => TraitMetadata) public tokenIdToMetadata; // this gets populated on mint with the commit-reveal, so a new incoming token id will get mapped to an existing TraitMetadata object, so multiple token ids will have the same TraitMetadata object (e.g. there are 9 token ids that are Blue Shirts, they're not consecutive, most likely but could be, a la art blocks engine)

    mapping(uint256 => string) public tokenIdToMetadataString;

    // e.g. Blue Hoodie => {
        // traitName: 'Blue Hoodie', traitType: TraitCategory.Name.Shirt, traitPath: 'svg code'
    // }
    mapping(string => TraitMetadata) public traitNameToMetadata;

    /// Errors

    error MsgSenderNotMinter();

    /// Modifiers

    modifier onlyMinter {
        if (msg.sender != minter) revert MsgSenderNotMinter();
        _;
    }

    constructor() ERC721("PeterTraits", "PTR") {

        traitsRenderer = new TraitsRenderer();
        bodyRenderer = new BodyRenderer();

        // Shirt
        // addNewTrait('Hoodie Black', TraitCategory.Name.Shirt, '<path fill="#000" d="M10 9h1v1h-1zM11 9h1v1h-1zM12 9h1v1h-1zM13 9h1v1h-1zM14 9h1v1h-1zM15 9h1v1h-1zM16 9h1v1h-1zM17 9h1v1h-1zM18 9h1v1h-1zM19 9h1v1h-1zM9 10h1v1H9zM10 10h1v1h-1zM11 10h1v1h-1zM19 10h1v1h-1zM20 10h1v1h-1zM9 11h1v1H9zM10 11h1v1h-1zM20 11h1v1h-1zM9 12h1v1H9zM10 12h1v1h-1zM20 12h1v1h-1zM9 13h1v1H9zM10 13h1v1h-1zM20 13h1v1h-1zM9 14h1v1H9zM10 14h1v1h-1zM20 14h1v1h-1zM10 15h1v1h-1zM11 15h1v1h-1zM19 15h1v1h-1zM20 15h1v1h-1zM11 16h1v1h-1zM12 16h1v1h-1zM13 16h1v1h-1zM17 16h1v1h-1zM18 16h1v1h-1zM19 16h1v1h-1zM10 17h1v1h-1zM11 17h1v1h-1zM12 17h1v1h-1z"/><path fill="#ECEDED" d="M13 17h1v1h-1z"/><path fill="#000" d="M14 17h1v1h-1zM15 17h1v1h-1zM16 17h1v1h-1z"/><path fill="#ECEDED" d="M17 17h1v1h-1z"/><path fill="#000" d="M18 17h1v1h-1zM9 18h1v1H9zM9 19h1v1H9zM18 19h1v1h-1zM10 18h1v1h-1zM10 19h1v1h-1zM19 19h1v1h-1zM11 18h1v1h-1zM12 18h1v1h-1zM13 18h1v1h-1zM14 18h1v1h-1zM15 18h1v1h-1zM16 18h1v1h-1zM17 18h1v1h-1zM18 18h1v1h-1zM19 18h1v1h-1zM11 19h1v1h-1zM11 20h1v1h-1zM12 20h1v1h-1zM13 20h1v1h-1zM14 20h1v1h-1zM15 20h1v1h-1zM16 20h1v1h-1zM17 20h1v1h-1zM12 19h1v1h-1zM13 19h1v1h-1zM14 19h1v1h-1zM15 19h1v1h-1zM16 19h1v1h-1zM17 19h1v1h-1z"/>' );
        // addNewTrait('Hoodie Red', TraitCategory.Name.Shirt, '<path fill="#EA0000" d="M10 9h1v1h-1zM11 9h1v1h-1zM12 9h1v1h-1zM13 9h1v1h-1zM14 9h1v1h-1zM15 9h1v1h-1zM16 9h1v1h-1zM17 9h1v1h-1zM18 9h1v1h-1zM19 9h1v1h-1zM9 10h1v1H9zM10 10h1v1h-1zM11 10h1v1h-1zM19 10h1v1h-1zM20 10h1v1h-1zM9 11h1v1H9zM10 11h1v1h-1zM20 11h1v1h-1zM9 12h1v1H9zM10 12h1v1h-1zM20 12h1v1h-1zM9 13h1v1H9zM10 13h1v1h-1zM20 13h1v1h-1zM9 14h1v1H9zM10 14h1v1h-1zM20 14h1v1h-1zM10 15h1v1h-1zM11 15h1v1h-1zM19 15h1v1h-1zM20 15h1v1h-1zM11 16h1v1h-1zM12 16h1v1h-1zM13 16h1v1h-1zM17 16h1v1h-1zM18 16h1v1h-1zM19 16h1v1h-1zM10 17h1v1h-1zM11 17h1v1h-1zM12 17h1v1h-1z"/><path fill="#ECEDED" d="M13 17h1v1h-1z"/><path fill="#EA0000" d="M14 17h1v1h-1zM15 17h1v1h-1zM16 17h1v1h-1z"/><path fill="#ECEDED" d="M17 17h1v1h-1z"/><path fill="#EA0000" d="M18 17h1v1h-1zM9 18h1v1H9zM9 19h1v1H9zM18 19h1v1h-1zM10 18h1v1h-1zM10 19h1v1h-1zM19 19h1v1h-1zM11 18h1v1h-1zM12 18h1v1h-1zM13 18h1v1h-1zM14 18h1v1h-1zM15 18h1v1h-1zM16 18h1v1h-1zM17 18h1v1h-1zM18 18h1v1h-1zM19 18h1v1h-1zM11 19h1v1h-1zM11 20h1v1h-1zM12 20h1v1h-1zM13 20h1v1h-1zM14 20h1v1h-1zM15 20h1v1h-1zM16 20h1v1h-1zM17 20h1v1h-1zM12 19h1v1h-1zM13 19h1v1h-1zM14 19h1v1h-1zM15 19h1v1h-1zM16 19h1v1h-1zM17 19h1v1h-1z"/>' );
        // addNewTrait('Blue Stripes', TraitCategory.Name.Shirt, '<rect x="11" y="16"  fill="#1A2099"></rect> <rect x="12" y="16"  fill="#1A2099"></rect> <rect x="17" y="16"  fill="#1A2099"></rect> <rect x="10" y="17"  fill="#1A2099"></rect> <rect x="11" y="17"  fill="#1A2099"></rect> <rect x="12" y="17"  fill="#1A2099"></rect> <rect x="13" y="17"  fill="#1A2099"></rect> <rect x="14" y="17"  fill="#F1F6F8"></rect> <rect x="15" y="17"  fill="#F1F6F8"></rect> <rect x="16" y="17"  fill="#F1F6F8"></rect> <rect x="17" y="17"  fill="#1A2099"></rect> <rect x="18" y="17"  fill="#1A2099"></rect> <rect x="9" y="18"  fill="#1A2099"></rect> <rect x="10" y="18"  fill="#1A2099"></rect> <rect x="11" y="18"  fill="#1A2099"></rect> <rect x="12" y="18"  fill="#1A2099"></rect> <rect x="13" y="18"  fill="#1A2099"></rect> <rect x="14" y="18"  fill="#F1F6F8"></rect> <rect x="15" y="18"  fill="#F1F6F8"></rect> <rect x="16" y="18"  fill="#E7E6E5"></rect> <rect x="17" y="18"  fill="#1A2099"></rect> <rect x="18" y="18"  fill="#1A2099"></rect> <rect x="19" y="18"  fill="#1A2099"></rect> <rect x="9" y="19"  fill="#1A2099"></rect> <rect x="10" y="19"  fill="#1A2099"></rect> <rect x="11" y="19"  fill="#1A2099"></rect> <rect x="12" y="19"  fill="#1A2099"></rect> <rect x="13" y="19"  fill="#1A2099"></rect> <rect x="14" y="19"  fill="#F1F6F8"></rect> <rect x="15" y="19"  fill="#F1F6F8"></rect> <rect x="16" y="19"  fill="#F1F6F8"></rect> <rect x="17" y="19"  fill="#1A2099"></rect> <rect x="18" y="19"  fill="#1A2099"></rect> <rect x="19" y="19"  fill="#1A2099"></rect> <rect x="11" y="20"  fill="#1A2099"></rect> <rect x="12" y="20"  fill="#1A2099"></rect> <rect x="13" y="20"  fill="#1A2099"></rect> <rect x="14" y="20"  fill="#F1F6F8"></rect> <rect x="15" y="20"  fill="#F1F6F8"></rect> <rect x="16" y="20"  fill="#F1F6F8"></rect> <rect x="17" y="20"  fill="#1A2099"></rect>' );

        // Pants
        // addNewTrait('Blue', TraitCategory.Name.Pants, '<rect x="11" y="21" width="1" height="1" fill="#0038CB"></rect> <rect x="12" y="21" width="1" height="1" fill="#013FE0"></rect> <rect x="13" y="21" width="1" height="1" fill="#013FE0"></rect> <rect x="14" y="21" width="1" height="1" fill="#0038CB"></rect> <rect x="15" y="21" width="1" height="1" fill="#013FE0"></rect> <rect x="16" y="21" width="1" height="1" fill="#013FE0"></rect> <rect x="17" y="21" width="1" height="1" fill="#0038CB"></rect> <rect x="11" y="22" width="1" height="1" fill="#013FE0"></rect> <rect x="12" y="22" width="1" height="1" fill="#013FE0"></rect> <rect x="13" y="22" width="1" height="1" fill="#013FE0"></rect> <rect x="15" y="22" width="1" height="1" fill="#013FE0"></rect> <rect x="16" y="22" width="1" height="1" fill="#013FE0"></rect> <rect x="17" y="22" width="1" height="1" fill="#013FE0"></rect>' );
        // addNewTrait('Purple', TraitCategory.Name.Pants, '<rect x="11" y="21" width="1" height="1" fill="#6C0B81" /> <rect x="12" y="21" width="1" height="1" fill="#7A0D92" /> <rect x="13" y="21" width="1" height="1" fill="#7A0D92" /> <rect x="14" y="21" width="1" height="1" fill="#6C0B81" /> <rect x="15" y="21" width="1" height="1" fill="#7A0D92" /> <rect x="16" y="21" width="1" height="1" fill="#7A0D92" /> <rect x="17" y="21" width="1" height="1" fill="#6C0B81" /> <rect x="11" y="22" width="1" height="1" fill="#7A0D92" /> <rect x="12" y="22" width="1" height="1" fill="#7A0D92" /> <rect x="13" y="22" width="1" height="1" fill="#7A0D92" /> <rect x="15" y="22" width="1" height="1" fill="#7A0D92" /> <rect x="16" y="22" width="1" height="1" fill="#7A0D92" /> <rect x="17" y="22" width="1" height="1" fill="#7A0D92" />' );
        // addNewTrait('Green', TraitCategory.Name.Pants, '<path d="M12 21H11V22H12V21Z" fill="#118907"/> <path d="M13 21H12V22H13V21Z" fill="#1BA00F"/> <path d="M14 21H13V22H14V21Z" fill="#1BA00F"/> <path d="M15 21H14V22H15V21Z" fill="#118907"/> <path d="M16 21H15V22H16V21Z" fill="#1BA00F"/> <path d="M17 21H16V22H17V21Z" fill="#1BA00F"/> <path d="M18 21H17V22H18V21Z" fill="#118907"/> <path d="M12 22H11V23H12V22Z" fill="#1BA00F"/> <path d="M13 22H12V23H13V22Z" fill="#1BA00F"/> <path d="M14 22H13V23H14V22Z" fill="#1BA00F"/> <path d="M16 22H15V23H16V22Z" fill="#1BA00F"/> <path d="M17 22H16V23H17V22Z" fill="#1BA00F"/> <path d="M18 22H17V23H18V22Z" fill="#1BA00F"/>');
    
        // for (uint i; i < 3; ++i) { // DEPLOY: remove
        //     safeMint(address(this)); // Mints 3 sets of traits
        // }
    
    }

    function addShirtType(string memory shirtName, string memory shirtSVG) public onlyOwner {
        // todo: add checks
        shirtTypeToSVG[shirtName] = shirtSVG;
    }

    function addPantsType(string memory pantsName, string memory pantsSVG) public onlyOwner {
        // todo: add checks
        pantsTypeToSVG[pantsName] = pantsSVG;
    }

    // todo: look to put back in onlyOwner
    function addNewTrait(string memory _traitName, TraitCategory.Name _traitType, string memory _traitPath) public  {
        
        TraitMetadata storage metadata = traitNameToMetadata[_traitName];
        
        /*
        // commenting out for now
        // todo: add checks of some kind
        // Check if we already have it
        if (keccak256(bytes(metadata.traitName)) != keccak256(bytes(''))) {
            revert('Trait already exists');
        }
        */
        metadata.traitName = _traitName;
        metadata.traitType = _traitType;
        metadata.traitPath = _traitPath;
    }

    // mints to a smart contract address that implements onERC721Received
    function safeMint(address to) public returns (uint256[] memory) { // TODO: add onlyMinter modifier
        // TODO: check supply?
        // TODO: add back in onlyMinter modifier

        uint256[] memory mintedIds = new uint256[](INITIAL_TRAIT_NUMBER);

        // Mint INITIAL_TRAIT_NUMBER traits for now

        /// mmm... when initially minting are we hardcoding 3 traits or some sort of RNG?
        for(uint i; i < INITIAL_TRAIT_NUMBER; i++) {

            uint tokenId = ++totalSupply;
            _safeMint(to, tokenId);
            mintedIds[i] = tokenId;

            if(i == 0) {
                //  commit-reveal would determine the shirt type
                if (tokenId == 1) {
                    tokenIdToMetadataString[tokenId] = 'Hoodie Black';
                } else if (tokenId == 3) {
                    tokenIdToMetadataString[tokenId] = 'Hoodie Red';
                } else {
                    tokenIdToMetadataString[tokenId] = 'Blue Stripes';
                }

            } else {
                //  commit-reveal would determine the pants type
                if (tokenId == 2) {
                    tokenIdToMetadataString[tokenId] = 'Blue';
                } else if (tokenId == 4) {
                    tokenIdToMetadataString[tokenId] = 'Purple';
                } else {
                    tokenIdToMetadataString[tokenId] = 'Green';
                }
            }
        }

        return mintedIds;
    }

     function tokenURI(uint256 _tokenId) public view override returns (string memory) {
        // _requireOwned(tokenId); // todo: put back in?

        return renderAsDataUri(_tokenId);
    }

    function getTrait(uint256 _tokenId) internal view returns (ITraitStorage.Trait memory trait) {
        ITraitStorage.StoredTrait memory stored = traits.all[_tokenId];
        trait.stored = stored;
    }

    function getTraitType(uint256 _tokenId) public view returns (TraitCategory.Name) {
        return traits.all[_tokenId].traitType;
    }

    function renderAsDataUri(uint256 _tokenId) public view returns (string memory) {
        string memory fullSvg;
        string memory traitSvg;
        string memory attributes;

        string memory bodyGhostSvg = bodyRenderer.getGhostSVG();

        TraitMetadata memory metadata = traitNameToMetadata[tokenIdToMetadataString[_tokenId]];
        traitSvg = metadata.traitPath;

        TraitCategory.Name traitTypeEnum = metadata.traitType;
        string memory traitTypeString = TraitCategory.toString(traitTypeEnum);

        attributes = RenderHelper.getTraitAsJson(traitTypeString, metadata.traitName);

        /*
        // Get trait from storage - OLD METHOD
        Trait memory trait = getTrait(_tokenId);

        (traitSvg, attributes) = traitsRenderer.getSVGFromStoredTrait(trait.stored);

        if (bytes(attributes).length == 0) attributes = '"attributes":[]'; // todo: remove, stops json error from happening locally
        */

        fullSvg = string.concat(
            SVG_START,
                bodyGhostSvg,
                traitSvg,
            '</svg>'
        );

        // string memory combinedSVG = svg;

        string memory image = string.concat(
            '"image":"data:image/svg+xml;base64,',
                Utils.encode(bytes(fullSvg)),
            '"'
        );

        string memory json = string.concat(
            '{"name":"Peter Trait #',
                Utils.toString(_tokenId),
             '","description":"This is just a test",',
                attributes,
            ',',
                image,
            '}'
        );

        return string.concat("data:application/json;base64,", Utils.encode(bytes(json)));
    }

    // Owner

    function setMinter(address _mainContractAddress) public onlyOwner {
        minter = _mainContractAddress;
    }

    function setRenderContract(address _address) public onlyOwner {
        traitsRenderer = TraitsRenderer(_address);
    }

    // TODO: look at other contracts for signing logic, import ECDSA, etc.
    function setSigner(address _signer) public onlyOwner {
        signer = _signer;
    }

}
