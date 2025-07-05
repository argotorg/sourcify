// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import { RenderHelper } from "./RenderHelper.sol";
import { Random, RandomCtx } from '../common/Random.sol';
import { IPeterStorage } from '../interfaces/IPeterStorage.sol';
import { ITraitStorage } from '../interfaces/ITraitStorage.sol';
import { Division } from "../common/Division.sol";

contract TraitsRenderer {

    string constant SVG_START = '<svg shape-rendering="crispEdges" viewBox="0 0 30 30" fill="none" xmlns="http://www.w3.org/2000/svg"><style>rect{width:1px; height: 1px;} .bg{width:30px; height: 30px;} </style><rect class="bg" fill="#0D6E9D"/>';

    // todo: maybe a getSVG and a getFullSVG method?

    // function getSVG(uint tokenId) public pure returns (string memory svg, string memory traitsAsString) {
    function getSVGFromStoredPeter(IPeterStorage.StoredPeter memory storedPeter) public pure returns (string memory, string memory) {
        string memory svg;
        string memory traitsAsString;

        // SHIRT
        RandomCtx memory rndCtx = Random.initCtx(storedPeter.shirtId);
        string memory typeName = RenderHelper.randomShirt(rndCtx); // returns Shirt 001 etc
        traitsAsString = RenderHelper.stringTrait('Shirt', typeName);
        svg = PeterShapes.renderShirtFromName(typeName);

        // PANTS
        rndCtx = Random.initCtx(storedPeter.pantsId);
        typeName = RenderHelper.randomPants(rndCtx); // returns Shirt 001 etc
        traitsAsString =  string.concat(traitsAsString, ',', RenderHelper.stringTrait('Pants', typeName));
        svg = string.concat(svg, PeterShapes.renderPantsFromName(typeName));

        return (svg, traitsAsString);
    }

     function getSVGFromStoredTrait(ITraitStorage.StoredTrait memory storedTrait) public pure returns (string memory svg, string memory traitAsString) {

        RandomCtx memory rndCtx = Random.initCtx(storedTrait.tokenId);

        svg = '';
        traitAsString = '';

        // yuck... todo: check for better way, maybe ENUMs?
        if (keccak256(abi.encodePacked(storedTrait.traitType)) == keccak256(abi.encodePacked("Shirt"))) {
            string memory typeName = RenderHelper.randomShirt(rndCtx); // returns Shirt 001 etc
            traitAsString = RenderHelper.getTraitAsJson('Shirt', typeName);
            svg = PeterShapes.renderShirtFromName(typeName);
        }

        if (keccak256(abi.encodePacked(storedTrait.traitType)) == keccak256(abi.encodePacked("Pants"))) {
            string memory typeName = RenderHelper.randomPants(rndCtx); // returns Shirt 001 etc
            traitAsString = RenderHelper.getTraitAsJson('Pants', typeName);
            svg = PeterShapes.renderPantsFromName(typeName);
        }

    }

    /*
    function getSVGForTokenId(uint _tokenId) public pure returns (string memory svg, string memory traitsAsString) {

        // SHIRT
        RandomCtx memory rndCtx = Random.initCtx(_tokenId);
        RenderHelper.TraitsInfo memory shirtTraits = RenderHelper.randomTraits(rndCtx);

        traitsAsString = RenderHelper.getTraitsAsJson(shirtTraits);

        svg = string.concat(PeterShapes.renderShirt(shirtTraits));
    }
    */

}

library PeterShapes {

    // these are all optimised by https://svgomg.net/ getting them down to 3KB from 6KB but combining areas
    string private constant HAIR_001 = '<rect x="13" y="5"  fill="#D700A8" /> <rect x="14" y="5"  fill="#D700A8" /> <rect x="15" y="5"  fill="#D700A8" /> <rect x="16" y="5"  fill="#D700A8" /> <rect x="17" y="5"  fill="#D700A8" /> <rect x="18" y="5"  fill="#D700A8" /> <rect x="19" y="5"  fill="#D700A8" /> <rect x="11" y="6"  fill="#D700A8" /> <rect x="12" y="6"  fill="#C30098" /> <rect x="13" y="6"  fill="#C30098" /> <rect x="14" y="6"  fill="#C30098" /> <rect x="15" y="6"  fill="#C30098" /> <rect x="16" y="6"  fill="#C30098" /> <rect x="17" y="6"  fill="#C30098" /> <rect x="18" y="6"  fill="#C30098" /> <rect x="19" y="6"  fill="#D700A8" /> <rect x="20" y="6"  fill="#D700A8" /> <rect x="11" y="7"  fill="#C30098" /> <rect x="12" y="7"  fill="#C30098" /> <rect x="13" y="7"  fill="#C30098" /> <rect x="14" y="7"  fill="#C30098" /> <rect x="15" y="7"  fill="#C30098" /> <rect x="16" y="7"  fill="#C30098" /> <rect x="17" y="7"  fill="#C30098" /> <rect x="18" y="7"  fill="#C30098" /> <rect x="19" y="7"  fill="#C30098" /> <rect x="20" y="7"  fill="#D700A8" /> <rect x="10" y="8"  fill="#D700A8" /> <rect x="11" y="8"  fill="#C30098" /> <rect x="12" y="8"  fill="#C30098" /> <rect x="13" y="8"  fill="#C30098" /> <rect x="14" y="8"  fill="#C30098" /> <rect x="15" y="8"  fill="#C30098" /> <rect x="16" y="8"  fill="#C30098" /> <rect x="17" y="8"  fill="#C30098" /> <rect x="18" y="8"  fill="#C30098" /> <rect x="19" y="8"  fill="#C30098" /> <rect x="10" y="9"  fill="#C30098" /> <rect x="11" y="9"  fill="#C30098" /> <rect x="12" y="9"  fill="#C30098" /> <rect x="13" y="9"  fill="#C30098" /> <rect x="14" y="9"  fill="#C30098" /> <rect x="15" y="9"  fill="#C30098" /> <rect x="16" y="9"  fill="#C30098" /> <rect x="17" y="9"  fill="#C30098" /> <rect x="18" y="9"  fill="#C30098" /> <rect x="19" y="9"  fill="#C30098" /> <rect x="10" y="10"  fill="#C30098" /> <rect x="11" y="10"  fill="#C30098" /> <rect x="10" y="11"  fill="#C30098" />';
    string private constant HAIR_002 = '<rect x="12" y="7"  fill="#D700A8" /> <rect x="13" y="7"  fill="#D700A8" /> <rect x="14" y="7"  fill="#D700A8" /> <rect x="15" y="7"  fill="#D700A8" /> <rect x="16" y="7"  fill="#B2008B" /> <rect x="17" y="7"  fill="#B2008B" /> <rect x="11" y="8"  fill="#D700A8" /> <rect x="12" y="8"  fill="#D700A8" /> <rect x="13" y="8"  fill="#D700A8" /> <rect x="14" y="8"  fill="#D700A8" /> <rect x="15" y="8"  fill="#D700A8" /> <rect x="16" y="8"  fill="#B2008B" /> <rect x="17" y="8"  fill="#B2008B" /> <rect x="10" y="9"  fill="#D700A8" /> <rect x="11" y="9"  fill="#D700A8" /> <rect x="16" y="9"  fill="#B2008B" /> <rect x="17" y="9"  fill="#B2008B" /> <rect x="10" y="10"  fill="#D700A8" /> <rect x="10" y="11"  fill="#D700A8" />';
    // string private constant HAIR_003 = '<rect x="12" y="7"  fill="#00C700"></rect> <rect x="13" y="7"  fill="#00C700"></rect> <rect x="14" y="7"  fill="#00C700"></rect> <rect x="15" y="7"  fill="#00C700"></rect> <rect x="16" y="7"  fill="#00A700"></rect> <rect x="17" y="7"  fill="#00A700"></rect> <rect x="11" y="8"  fill="#00C700"></rect> <rect x="12" y="8"  fill="#00C700"></rect> <rect x="13" y="8"  fill="#00C700"></rect> <rect x="14" y="8"  fill="#00C700"></rect> <rect x="15" y="8"  fill="#00C700"></rect> <rect x="16" y="8"  fill="#00A700"></rect> <rect x="17" y="8"  fill="#00A700"></rect> <rect x="10" y="9"  fill="#00C700"></rect> <rect x="11" y="9"  fill="#00C700"></rect> <rect x="16" y="9"  fill="#00A700"></rect> <rect x="17" y="9"  fill="#00A700"></rect> <rect x="10" y="10"  fill="#00C700"></rect> <rect x="10" y="11"  fill="#00C700"></rect>';

    string private constant SHIRT_001 = '<path fill="#000" d="M10 9h1v1h-1zM11 9h1v1h-1zM12 9h1v1h-1zM13 9h1v1h-1zM14 9h1v1h-1zM15 9h1v1h-1zM16 9h1v1h-1zM17 9h1v1h-1zM18 9h1v1h-1zM19 9h1v1h-1zM9 10h1v1H9zM10 10h1v1h-1zM11 10h1v1h-1zM19 10h1v1h-1zM20 10h1v1h-1zM9 11h1v1H9zM10 11h1v1h-1zM20 11h1v1h-1zM9 12h1v1H9zM10 12h1v1h-1zM20 12h1v1h-1zM9 13h1v1H9zM10 13h1v1h-1zM20 13h1v1h-1zM9 14h1v1H9zM10 14h1v1h-1zM20 14h1v1h-1zM10 15h1v1h-1zM11 15h1v1h-1zM19 15h1v1h-1zM20 15h1v1h-1zM11 16h1v1h-1zM12 16h1v1h-1zM13 16h1v1h-1zM17 16h1v1h-1zM18 16h1v1h-1zM19 16h1v1h-1zM10 17h1v1h-1zM11 17h1v1h-1zM12 17h1v1h-1z"/><path fill="#ECEDED" d="M13 17h1v1h-1z"/><path fill="#000" d="M14 17h1v1h-1zM15 17h1v1h-1zM16 17h1v1h-1z"/><path fill="#ECEDED" d="M17 17h1v1h-1z"/><path fill="#000" d="M18 17h1v1h-1zM9 18h1v1H9zM9 19h1v1H9zM18 19h1v1h-1zM10 18h1v1h-1zM10 19h1v1h-1zM19 19h1v1h-1zM11 18h1v1h-1zM12 18h1v1h-1zM13 18h1v1h-1zM14 18h1v1h-1zM15 18h1v1h-1zM16 18h1v1h-1zM17 18h1v1h-1zM18 18h1v1h-1zM19 18h1v1h-1zM11 19h1v1h-1zM11 20h1v1h-1zM12 20h1v1h-1zM13 20h1v1h-1zM14 20h1v1h-1zM15 20h1v1h-1zM16 20h1v1h-1zM17 20h1v1h-1zM12 19h1v1h-1zM13 19h1v1h-1zM14 19h1v1h-1zM15 19h1v1h-1zM16 19h1v1h-1zM17 19h1v1h-1z"/>';
    string private constant SHIRT_002 = '<path fill="#EA0000" d="M10 9h1v1h-1zM11 9h1v1h-1zM12 9h1v1h-1zM13 9h1v1h-1zM14 9h1v1h-1zM15 9h1v1h-1zM16 9h1v1h-1zM17 9h1v1h-1zM18 9h1v1h-1zM19 9h1v1h-1zM9 10h1v1H9zM10 10h1v1h-1zM11 10h1v1h-1zM19 10h1v1h-1zM20 10h1v1h-1zM9 11h1v1H9zM10 11h1v1h-1zM20 11h1v1h-1zM9 12h1v1H9zM10 12h1v1h-1zM20 12h1v1h-1zM9 13h1v1H9zM10 13h1v1h-1zM20 13h1v1h-1zM9 14h1v1H9zM10 14h1v1h-1zM20 14h1v1h-1zM10 15h1v1h-1zM11 15h1v1h-1zM19 15h1v1h-1zM20 15h1v1h-1zM11 16h1v1h-1zM12 16h1v1h-1zM13 16h1v1h-1zM17 16h1v1h-1zM18 16h1v1h-1zM19 16h1v1h-1zM10 17h1v1h-1zM11 17h1v1h-1zM12 17h1v1h-1z"/><path fill="#ECEDED" d="M13 17h1v1h-1z"/><path fill="#EA0000" d="M14 17h1v1h-1zM15 17h1v1h-1zM16 17h1v1h-1z"/><path fill="#ECEDED" d="M17 17h1v1h-1z"/><path fill="#EA0000" d="M18 17h1v1h-1zM9 18h1v1H9zM9 19h1v1H9zM18 19h1v1h-1zM10 18h1v1h-1zM10 19h1v1h-1zM19 19h1v1h-1zM11 18h1v1h-1zM12 18h1v1h-1zM13 18h1v1h-1zM14 18h1v1h-1zM15 18h1v1h-1zM16 18h1v1h-1zM17 18h1v1h-1zM18 18h1v1h-1zM19 18h1v1h-1zM11 19h1v1h-1zM11 20h1v1h-1zM12 20h1v1h-1zM13 20h1v1h-1zM14 20h1v1h-1zM15 20h1v1h-1zM16 20h1v1h-1zM17 20h1v1h-1zM12 19h1v1h-1zM13 19h1v1h-1zM14 19h1v1h-1zM15 19h1v1h-1zM16 19h1v1h-1zM17 19h1v1h-1z"/>';
    // string private constant SHIRT_003 = '<rect x="11" y="16"  fill="#1A2099"></rect> <rect x="12" y="16"  fill="#1A2099"></rect> <rect x="17" y="16"  fill="#1A2099"></rect> <rect x="10" y="17"  fill="#1A2099"></rect> <rect x="11" y="17"  fill="#1A2099"></rect> <rect x="12" y="17"  fill="#1A2099"></rect> <rect x="13" y="17"  fill="#1A2099"></rect> <rect x="14" y="17"  fill="#F1F6F8"></rect> <rect x="15" y="17"  fill="#F1F6F8"></rect> <rect x="16" y="17"  fill="#F1F6F8"></rect> <rect x="17" y="17"  fill="#1A2099"></rect> <rect x="18" y="17"  fill="#1A2099"></rect> <rect x="9" y="18"  fill="#1A2099"></rect> <rect x="10" y="18"  fill="#1A2099"></rect> <rect x="11" y="18"  fill="#1A2099"></rect> <rect x="12" y="18"  fill="#1A2099"></rect> <rect x="13" y="18"  fill="#1A2099"></rect> <rect x="14" y="18"  fill="#F1F6F8"></rect> <rect x="15" y="18"  fill="#F1F6F8"></rect> <rect x="16" y="18"  fill="#E7E6E5"></rect> <rect x="17" y="18"  fill="#1A2099"></rect> <rect x="18" y="18"  fill="#1A2099"></rect> <rect x="19" y="18"  fill="#1A2099"></rect> <rect x="9" y="19"  fill="#1A2099"></rect> <rect x="10" y="19"  fill="#1A2099"></rect> <rect x="11" y="19"  fill="#1A2099"></rect> <rect x="12" y="19"  fill="#1A2099"></rect> <rect x="13" y="19"  fill="#1A2099"></rect> <rect x="14" y="19"  fill="#F1F6F8"></rect> <rect x="15" y="19"  fill="#F1F6F8"></rect> <rect x="16" y="19"  fill="#F1F6F8"></rect> <rect x="17" y="19"  fill="#1A2099"></rect> <rect x="18" y="19"  fill="#1A2099"></rect> <rect x="19" y="19"  fill="#1A2099"></rect> <rect x="11" y="20"  fill="#1A2099"></rect> <rect x="12" y="20"  fill="#1A2099"></rect> <rect x="13" y="20"  fill="#1A2099"></rect> <rect x="14" y="20"  fill="#F1F6F8"></rect> <rect x="15" y="20"  fill="#F1F6F8"></rect> <rect x="16" y="20"  fill="#F1F6F8"></rect> <rect x="17" y="20"  fill="#1A2099"></rect>';

    string private constant PANTS_001 = '<rect x="11" y="21" width="1" height="1" fill="#6C0B81" /> <rect x="12" y="21" width="1" height="1" fill="#7A0D92" /> <rect x="13" y="21" width="1" height="1" fill="#7A0D92" /> <rect x="14" y="21" width="1" height="1" fill="#6C0B81" /> <rect x="15" y="21" width="1" height="1" fill="#7A0D92" /> <rect x="16" y="21" width="1" height="1" fill="#7A0D92" /> <rect x="17" y="21" width="1" height="1" fill="#6C0B81" /> <rect x="11" y="22" width="1" height="1" fill="#7A0D92" /> <rect x="12" y="22" width="1" height="1" fill="#7A0D92" /> <rect x="13" y="22" width="1" height="1" fill="#7A0D92" /> <rect x="15" y="22" width="1" height="1" fill="#7A0D92" /> <rect x="16" y="22" width="1" height="1" fill="#7A0D92" /> <rect x="17" y="22" width="1" height="1" fill="#7A0D92" />';
    string private constant PANTS_002 = '<rect x="11" y="21" width="1" height="1" fill="#0038CB"></rect> <rect x="12" y="21" width="1" height="1" fill="#013FE0"></rect> <rect x="13" y="21" width="1" height="1" fill="#013FE0"></rect> <rect x="14" y="21" width="1" height="1" fill="#0038CB"></rect> <rect x="15" y="21" width="1" height="1" fill="#013FE0"></rect> <rect x="16" y="21" width="1" height="1" fill="#013FE0"></rect> <rect x="17" y="21" width="1" height="1" fill="#0038CB"></rect> <rect x="11" y="22" width="1" height="1" fill="#013FE0"></rect> <rect x="12" y="22" width="1" height="1" fill="#013FE0"></rect> <rect x="13" y="22" width="1" height="1" fill="#013FE0"></rect> <rect x="15" y="22" width="1" height="1" fill="#013FE0"></rect> <rect x="16" y="22" width="1" height="1" fill="#013FE0"></rect> <rect x="17" y="22" width="1" height="1" fill="#013FE0"></rect>';
    // string private constant PANTS_003 = '<path d="M12 21H11V22H12V21Z" fill="#118907"/> <path d="M13 21H12V22H13V21Z" fill="#1BA00F"/> <path d="M14 21H13V22H14V21Z" fill="#1BA00F"/> <path d="M15 21H14V22H15V21Z" fill="#118907"/> <path d="M16 21H15V22H16V21Z" fill="#1BA00F"/> <path d="M17 21H16V22H17V21Z" fill="#1BA00F"/> <path d="M18 21H17V22H18V21Z" fill="#118907"/> <path d="M12 22H11V23H12V22Z" fill="#1BA00F"/> <path d="M13 22H12V23H13V22Z" fill="#1BA00F"/> <path d="M14 22H13V23H14V22Z" fill="#1BA00F"/> <path d="M16 22H15V23H16V22Z" fill="#1BA00F"/> <path d="M17 22H16V23H17V22Z" fill="#1BA00F"/> <path d="M18 22H17V23H18V22Z" fill="#1BA00F"/>';

    /*
    function renderHair(PeterTraits.TraitsInfo memory traits) internal pure returns (string memory svg) {

        if(traits.hair == PeterTraits.Hair.HAIR_001) {
            svg = HAIR_001;
        }
        if(traits.hair == PeterTraits.Hair.HAIR_002) {
            svg = HAIR_002;
        }
        // if(traits.hair == PeterTraits.Hair.HAIR_003) {
        //     svg = HAIR_003;
        // }
    }
    */

     function renderShirt(RenderHelper.TraitsInfo memory traits) internal pure returns (string memory svg) {

        if(traits.shirt == RenderHelper.Shirt.SHIRT_001) {
            svg = SHIRT_001;
        }
        if(traits.shirt == RenderHelper.Shirt.SHIRT_002) {
            svg = SHIRT_002;
        }
        // if(traits.shirt == PeterTraits.Shirt.SHIRT_003) {
        //     svg = SHIRT_003;
        // }
    }

    function renderShirtFromName(string memory typeName) internal pure returns (string memory svg) {

        if (keccak256(abi.encodePacked(typeName)) == keccak256(abi.encodePacked("Shirt 001"))) {
            svg = SHIRT_001;
        }
       if (keccak256(abi.encodePacked(typeName)) == keccak256(abi.encodePacked("Shirt 002"))) {
            svg = SHIRT_002;
        }
    }

    function renderPants(RenderHelper.TraitsInfo memory traits) internal pure returns (string memory svg) {

        if(traits.pants == RenderHelper.Pants.PANTS_001) {
            svg = PANTS_001;
        }
        if(traits.pants == RenderHelper.Pants.PANTS_002) {
            svg = PANTS_002;
        }
        // if(traits.pants == PeterTraits.Pants.PANTS_003) {
        //     svg = PANTS_003;
        // }
    }

    // yuck!
    function renderPantsFromName(string memory typeName) internal pure returns (string memory svg) {

        if (keccak256(abi.encodePacked(typeName)) == keccak256(abi.encodePacked("Pants 001"))) {
            svg = PANTS_001;
        }
       if (keccak256(abi.encodePacked(typeName)) == keccak256(abi.encodePacked("Pants 002"))) {
            svg = PANTS_002;
        }
    }

    // function renderShoes(RenderHelper.TraitsInfo memory traits) internal pure returns (string memory svg) {

    //     if(traits.shoes == RenderHelper.Shoes.SHOES_001) {
    //         svg = SHOES_001;
    //     }
    //     if(traits.shoes == RenderHelper.Shoes.PANTSHOES_002) {
    //         svg = SHOES_002;
    //     }
    // }

}
