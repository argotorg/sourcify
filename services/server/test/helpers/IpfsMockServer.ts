import http from "http";
import type { AddressInfo } from "net";
import path from "path";
import { readFilesFromDirectory } from "./helpers";

const IPFS_MOCK_DIR = path.join(__dirname, "..", "mocks", "ipfs");

let mockServer: http.Server | undefined;
let mockGatewayUrl: string | undefined;

/**
 * Starts a local HTTP server that serves the files in `test/mocks/ipfs`
 * under `/ipfs/<cid>`. Returns the gateway url.
 *
 * The verification workers run in separate threads. nock only intercepts
 * requests in the main thread, so a real server is necessary.
 */
export async function getIpfsMockGatewayUrl(): Promise<string> {
  if (mockGatewayUrl) {
    return mockGatewayUrl;
  }

  const mockContent = await readFilesFromDirectory(IPFS_MOCK_DIR);

  mockServer = http.createServer((req, res) => {
    const match = /^\/ipfs\/([^/?]+)/.exec(req.url || "");
    const cid = match ? match[1] : "";
    if (!Object.prototype.hasOwnProperty.call(mockContent, cid)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(mockContent[cid]);
  });
  // Do not keep the process alive because of this server
  mockServer.unref();

  await new Promise<void>((resolve) =>
    mockServer!.listen(0, "127.0.0.1", resolve),
  );
  const { port } = mockServer.address() as AddressInfo;
  mockGatewayUrl = `http://127.0.0.1:${port}/ipfs/`;
  return mockGatewayUrl;
}
