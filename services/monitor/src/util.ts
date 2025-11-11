import type { SolidityDecodedObject } from "@ethereum-sourcify/bytecode-utils";
import type { DecentralizedStorageOrigin } from "./types";

export type FetchedFileCallback = (fetchedFile: string) => any;

interface Prefix {
  regex: RegExp;
  origin: DecentralizedStorageOrigin;
}

const PREFIXES: Prefix[] = [
  { origin: "ipfs", regex: /dweb:\/ipfs\/{1,2}/ },
  { origin: "bzzr1", regex: /bzz-raw:\/{1,2}/ },
];

const KNOWN_CBOR_ORIGINS: DecentralizedStorageOrigin[] = [
  "ipfs",
  "bzzr0",
  "bzzr1",
];

export class FileHash {
  origin: DecentralizedStorageOrigin;
  hash: string;

  constructor(origin: DecentralizedStorageOrigin, hash: string) {
    this.origin = origin;
    this.hash = hash;
  }

  /**
   * @returns a unique identifier of this source address of format ipfs-QmawU3NM1WNWkBauRudYCiFvuFE1tTLHB98akyBvb9UWwA
   */
  getSourceHash(): string {
    return this.origin + "-" + this.hash;
  }

  static fromUrl(url: string): FileHash | null {
    for (const prefix of PREFIXES) {
      const hash = url.replace(prefix.regex, "");
      if (hash !== url) {
        return new FileHash(prefix.origin, hash);
      }
    }
    return null;
  }

  static fromCborData(cborData: SolidityDecodedObject): FileHash {
    for (const origin of KNOWN_CBOR_ORIGINS) {
      const fileHash = cborData[origin];
      if (fileHash) {
        return new FileHash(origin, fileHash);
      }
    }

    const msg = `None of the keys ${KNOWN_CBOR_ORIGINS.join(
      ",",
    )} found in the CBOR data. CBOR keys found are: ${Object.keys(cborData)}`;
    throw new Error(msg);
  }
}

export class TimeoutError extends Error {
  timeout: boolean;

  constructor(message: string, timeout = true) {
    super(message);
    this.name = "TimeoutError";
    this.timeout = timeout;

    // This is to make the instanceof operator work with custom errors when using TypeScript
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}
