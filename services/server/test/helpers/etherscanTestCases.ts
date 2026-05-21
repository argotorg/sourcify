import nock from "nock";
import type { JsonRpcSigner } from "ethers";
import type {
  SourcifyChain,
  VerificationStatus,
} from "@ethereum-sourcify/lib-sourcify";
import { deployFromBytecodeForCreatorTxHash } from "./helpers";
import singleFixture from "./etherscanResponseFixtures/single.json";
import multipleFixture from "./etherscanResponseFixtures/multiple.json";
import standardJsonFixture from "./etherscanResponseFixtures/standardJson.json";
import vyperSingleFixture from "./etherscanResponseFixtures/vyperSingle.json";
import vyperStandardJsonFixture from "./etherscanResponseFixtures/vyperStandardJson.json";
import malformedVersionFixture from "./etherscanResponseFixtures/malformedVersion.json";
import exactMatchFixture from "./etherscanResponseFixtures/exactMatch.json";
import unverifiedResponse from "./etherscanResponseFixtures/unverified.json";
import invalidApiKeyResponse from "./etherscanResponseFixtures/invalidApiKey.json";
import rateLimitResponse from "./etherscanResponseFixtures/rateLimit.json";
import solc11Response from "./etherscanResponseFixtures/solc11.json";
import malformedNightlyResponse from "./etherscanResponseFixtures/malformedNightly.json";
import malformedVyperVersionResponse from "./etherscanResponseFixtures/malformedVyperVersion.json";

// Each verification test case bundles its Etherscan response, the creation
// bytecode to deploy on hardhat, and the expected verification status — so a
// single test reads everything it needs from one CAPITALIZED constant.
export type EtherscanTestCase = {
  etherscanResponse: any;
  creationBytecode: string;
  expectedStatus: VerificationStatus;
};

export const SINGLE_CONTRACT: EtherscanTestCase = {
  etherscanResponse: singleFixture.etherscanResponse,
  creationBytecode: singleFixture.creationBytecode,
  expectedStatus: "partial",
};

export const MULTIPLE_CONTRACT: EtherscanTestCase = {
  etherscanResponse: multipleFixture.etherscanResponse,
  creationBytecode: multipleFixture.creationBytecode,
  expectedStatus: "partial",
};

export const STANDARD_JSON_CONTRACT: EtherscanTestCase = {
  etherscanResponse: standardJsonFixture.etherscanResponse,
  creationBytecode: standardJsonFixture.creationBytecode,
  expectedStatus: "partial",
};

export const VYPER_SINGLE_CONTRACT: EtherscanTestCase = {
  etherscanResponse: vyperSingleFixture.etherscanResponse,
  creationBytecode: vyperSingleFixture.creationBytecode,
  expectedStatus: "partial",
};

export const VYPER_STANDARD_JSON_CONTRACT: EtherscanTestCase = {
  etherscanResponse: vyperStandardJsonFixture.etherscanResponse,
  creationBytecode: vyperStandardJsonFixture.creationBytecode,
  expectedStatus: "partial",
};

export const MALFORMED_VERSION_CONTRACT: EtherscanTestCase = {
  etherscanResponse: malformedVersionFixture.etherscanResponse,
  creationBytecode: malformedVersionFixture.creationBytecode,
  expectedStatus: "partial",
};

export const STANDARD_JSON_CONTRACT_EXACT_MATCH: EtherscanTestCase = {
  etherscanResponse: exactMatchFixture.etherscanResponse,
  creationBytecode: exactMatchFixture.creationBytecode,
  expectedStatus: "perfect",
};

// Error / edge-case responses (no contract to deploy — these tests don't reach
// the verification worker).
export const UNVERIFIED_CONTRACT_RESPONSE = unverifiedResponse;
export const INVALID_API_KEY_RESPONSE = invalidApiKeyResponse;
export const RATE_LIMIT_REACHED_RESPONSE = rateLimitResponse;
export const SOLC_1_1_CONTRACT_RESPONSE = solc11Response;
export const MALFORMED_NIGHLTY_VERSION_RESPONSE = malformedNightlyResponse;
export const MALFORMED_VYPER_VERSION_RESPONSE = malformedVyperVersionResponse;

// Iteration order = deployment order. Each entry's key is also the lookup key
// in the EtherscanDeployments map returned by deployEtherscanFixtures.
const VERIFICATION_TEST_CASES = {
  SINGLE_CONTRACT,
  MULTIPLE_CONTRACT,
  STANDARD_JSON_CONTRACT,
  VYPER_SINGLE_CONTRACT,
  VYPER_STANDARD_JSON_CONTRACT,
  MALFORMED_VERSION_CONTRACT,
  STANDARD_JSON_CONTRACT_EXACT_MATCH,
} as const;

export type EtherscanFixtureKey = keyof typeof VERIFICATION_TEST_CASES;

export type EtherscanFixtureDeployment = {
  address: string;
  creatorTxHash: string;
  blockNumber: number;
};

export type EtherscanDeployments = Partial<
  Record<EtherscanFixtureKey, EtherscanFixtureDeployment>
>;

export async function deployEtherscanFixtures(
  signer: JsonRpcSigner,
): Promise<EtherscanDeployments> {
  const deployments: EtherscanDeployments = {};
  for (const key of Object.keys(
    VERIFICATION_TEST_CASES,
  ) as EtherscanFixtureKey[]) {
    const { contractAddress, txHash, blockNumber } =
      await deployFromBytecodeForCreatorTxHash(
        signer,
        VERIFICATION_TEST_CASES[key].creationBytecode,
      );
    deployments[key] = {
      address: contractAddress,
      creatorTxHash: txHash,
      blockNumber,
    };
  }
  return deployments;
}

export const mockEtherscanApi = (
  sourcifyChain: SourcifyChain,
  contractAddress: string,
  response: any,
  userApiKey?: string,
): nock.Scope => {
  if (!sourcifyChain.etherscanApi?.supported) {
    chai.assert.fail(
      `Etherscan for chain ${sourcifyChain.chainId} not configured`,
    );
  }
  const apiKey =
    userApiKey !== undefined
      ? userApiKey
      : process.env[sourcifyChain.etherscanApi.apiKeyEnvName || ""] ||
        process.env.ETHERSCAN_API_KEY ||
        "";
  const customUrl = sourcifyChain.etherscanApi?.url;
  if (customUrl) {
    return nock(customUrl)
      .get(
        `/api?module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`,
      )
      .reply(function () {
        return [200, response];
      });
  }
  return nock("https://api.etherscan.io/v2")
    .get(
      `/api?chainid=${sourcifyChain.chainId}&module=contract&action=getsourcecode&address=${contractAddress}&apikey=${apiKey}`,
    )
    .reply(function () {
      return [200, response];
    });
};
