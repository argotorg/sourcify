import type { JsonRpcSigner } from "ethers";
import { ContractFactory } from "ethers";
import nock from "nock";
import { expect } from "chai";

export async function deployFromAbiAndBytecode(
  signer: JsonRpcSigner,
  abi: any[],
  bytecode: string,
  args: any[],
) {
  const contractFactory = new ContractFactory(abi, bytecode, signer);
  console.log(`Deploying contract ${args?.length ? `with args ${args}` : ""}`);
  const deployment = await contractFactory.deploy(...(args || []));
  await deployment.waitForDeployment();

  const contractAddress = await deployment.getAddress();
  console.log(`Deployed contract at ${contractAddress}`);
  return contractAddress;
}

/**
 * Returns a nock scope that later can be checked with isDone() if it was called.
 *
 * I.e. check if a request to serverUrl was made with the expected chainId and address.
 */
export function nockInterceptorForVerification(
  serverUrl: string,
  expectedChainId: number,
  expectedAddress: string,
) {
  return nock(serverUrl)
    .post("/")
    .reply(function (uri, requestBody) {
      const body = requestBody as {
        address: string;
        chainId: string;
      };
      expect(body.chainId).to.equal(expectedChainId.toString());
      expect(body.address).to.equal(expectedAddress);
      const { address, chainId } = body;
      return [200, { address, chainId, status: "perfect" }];
    });
}
