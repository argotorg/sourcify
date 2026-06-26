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
 * I.e. check if a request to serverUrl was made with the expected chainId and
 * address, and a body containing `sources` and `metadata`.
 */
export function nockInterceptorForVerification(
  serverUrl: string,
  expectedChainId: number,
  expectedAddress: string,
) {
  const { origin, pathname } = new URL(serverUrl);
  const basePath = pathname.replace(/\/+$/, "");
  const verifyPath = `${basePath}/v2/verify/metadata/${expectedChainId}/${expectedAddress}`;
  return nock(origin)
    .post(verifyPath, (body) => {
      expect(body).to.have.property("sources");
      expect(body).to.have.property("metadata");
      return true;
    })
    .reply(202, {
      verificationId: "00000000-0000-0000-0000-000000000000",
    });
}
