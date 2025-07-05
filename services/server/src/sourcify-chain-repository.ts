import {
  SourcifyChain,
  SourcifyChainMap,
} from "@ethereum-sourcify/lib-sourcify";
import { BadRequestError } from "./common/errors/BadRequestError";

export class ChainRepository {
  readonly sourcifyChainsArray: SourcifyChain[];
  readonly supportedChainsArray: SourcifyChain[];
  readonly supportedChainMap: SourcifyChainMap;

  constructor(readonly sourcifyChainMap: SourcifyChainMap) {
    this.sourcifyChainsArray = this._sourcifyChainsArray();
    this.supportedChainsArray = this._supportedChainsArray();
    this.supportedChainMap = this._supportedChainMap();
  }

  // Gets the chainsMap, sorts the chains, returns SourcifyChain array.
  private _sourcifyChainsArray(): SourcifyChain[] {
    const chainsArray = Object.values(this.sourcifyChainMap);
    // Have Ethereum chains on top.
    const ethereumChainIds = [1, 560048, 11155111, 17000, 5, 3, 4];
    const ethereumChains = [] as SourcifyChain[];
    ethereumChainIds.forEach((id) => {
      // Ethereum chains might not be in a custom chains.json
      if (this.sourcifyChainMap[id] === undefined) {
        return;
      }
      // Use long form name for Ethereum netorks e.g. "Ethereum Testnet Goerli" instead of "Goerli"
      this.sourcifyChainMap[id].name =
        this.sourcifyChainMap[id].title || this.sourcifyChainMap[id].name;
      ethereumChains.push(this.sourcifyChainMap[id]);
    });
    // Others, sorted by chainId strings
    const otherChains = chainsArray
      .filter((chain) => !ethereumChainIds.includes(chain.chainId))
      .sort((a, b) => {
        const aStr = a.title || a.name;
        const bStr = b.title || b.name;
        return aStr > bStr ? 1 : aStr < bStr ? -1 : 0;
      });

    const sortedChains = ethereumChains.concat(otherChains);
    return sortedChains;
  }

  _supportedChainMap(): SourcifyChainMap {
    return this._supportedChainsArray().reduce(
      (map, chain) => ((map[chain.chainId.toString()] = chain), map),
      <SourcifyChainMap>{},
    );
  }

  _supportedChainsArray(): SourcifyChain[] {
    return this._sourcifyChainsArray().filter((chain) => chain.supported);
  }

  /**
   * To check if a chain is supported for verification.
   * Note that there might be chains not supported for verification anymore but still exist as a SourcifyChain e.g. Ropsten.
   */
  checkSupportedChainId(chainId: string) {
    if (
      !(
        chainId in this.sourcifyChainMap &&
        this.sourcifyChainMap[chainId].supported
      )
    ) {
      throw new BadRequestError(
        `Chain ${chainId} not supported for verification!`,
      );
    }
    return true;
  }

  /**
   * To check if a chain exists as a SourcifyChain.
   * Note that there might be chains not supported for verification anymore but still exist as a SourcifyChain e.g. Ropsten.
   */
  checkSourcifyChainId(chainId: string) {
    if (
      !(chainId in this.sourcifyChainMap && this.sourcifyChainMap[chainId]) &&
      chainId != "0"
    ) {
      throw new Error(`Chain ${chainId} is not a Sourcify chain!`);
    }
    return true;
  }

  /**
   * Validation function for multiple chainIds
   * Note that this checks if a chain exists as a SourcifyChain.
   * This is different that checking for verification support i.e. supported: true or monitoring support i.e. monitored: true
   */
  validateSourcifyChainIds(chainIds: string) {
    const chainIdsArray = chainIds.split(",");
    const validChainIds: string[] = [];
    const invalidChainIds: string[] = [];
    for (const chainId of chainIdsArray) {
      try {
        if (this.checkSourcifyChainId(chainId)) {
          validChainIds.push(chainId);
        }
      } catch (e) {
        invalidChainIds.push(chainId);
      }
    }

    if (invalidChainIds.length) {
      throw new Error(`Invalid chainIds: ${invalidChainIds.join(", ")}`);
    }
    return true;
  }
}
