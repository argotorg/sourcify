import http from "http";
import { URL } from "url";
import etherscanBytecodes from "./etherscanBytecodes.json";

type ChainBytecodeEntry = {
  runtimeBytecode: string;
  creationBytecode?: string;
  creatorTxHash?: string;
};

/**
 * Real local HTTP server that responds to JSON-RPC (eth_getCode,
 * eth_getTransactionByHash, eth_getTransactionReceipt) and GET /api
 * (Etherscan-style action=getcontractcreation) for a given chain.
 *
 * Sourced from etherscanBytecodes.json. Must be a real server (not nock)
 * because v2 verification runs in Piscina worker threads and nock's
 * HTTP-module patches don't propagate across thread boundaries.
 */
export const startMockRpcServer = (
  chainId: string,
  port: number,
): Promise<http.Server> => {
  const chainBytecodes =
    (etherscanBytecodes as Record<string, Record<string, ChainBytecodeEntry>>)[
      chainId
    ] ?? {};

  // Lowercase-keyed address → entry
  const byAddress = new Map<string, ChainBytecodeEntry & { address: string }>(
    Object.entries(chainBytecodes).map(([addr, entry]) => [
      addr.toLowerCase(),
      { ...entry, address: addr },
    ]),
  );

  // Lowercase tx hash → { address, creationBytecode }
  const byTxHash = new Map<
    string,
    { address: string; creationBytecode: string }
  >();
  for (const [addr, entry] of Object.entries(chainBytecodes)) {
    if (entry.creatorTxHash && entry.creationBytecode) {
      byTxHash.set(entry.creatorTxHash.toLowerCase(), {
        address: addr,
        creationBytecode: entry.creationBytecode,
      });
    }
  }

  const handleRpcRequest = (req: {
    method: string;
    params: any[];
    id: any;
  }) => {
    if (req.method === "eth_getCode") {
      const addr = (req.params[0] as string).toLowerCase();
      const entry = byAddress.get(addr);
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: entry?.runtimeBytecode ?? "0x",
      };
    }

    if (req.method === "eth_getTransactionByHash") {
      const hash = (req.params[0] as string).toLowerCase();
      const record = byTxHash.get(hash);
      if (!record) {
        return { jsonrpc: "2.0", id: req.id, result: null };
      }
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          hash: req.params[0],
          blockHash:
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          blockNumber: "0x1",
          transactionIndex: "0x0",
          from: "0x0000000000000000000000000000000000000001",
          to: null,
          value: "0x0",
          gas: "0x186a0",
          gasPrice: "0x1",
          nonce: "0x0",
          input: record.creationBytecode,
          v: "0x1",
          r: "0x0000000000000000000000000000000000000000000000000000000000000001",
          s: "0x0000000000000000000000000000000000000000000000000000000000000001",
          type: "0x0",
          chainId: "0x1",
        },
      };
    }

    if (req.method === "eth_getTransactionReceipt") {
      const hash = (req.params[0] as string).toLowerCase();
      const record = byTxHash.get(hash);
      if (!record) {
        return { jsonrpc: "2.0", id: req.id, result: null };
      }
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          transactionHash: req.params[0],
          transactionIndex: "0x0",
          blockHash:
            "0x0000000000000000000000000000000000000000000000000000000000000001",
          blockNumber: "0x1",
          from: "0x0000000000000000000000000000000000000001",
          to: null,
          cumulativeGasUsed: "0x186a0",
          gasUsed: "0x186a0",
          contractAddress: record.address.toLowerCase(),
          logs: [],
          logsBloom: "0x" + "0".repeat(512),
          status: "0x1",
          type: "0x0",
        },
      };
    }

    return { jsonrpc: "2.0", id: req.id, result: null };
  };

  const handleEtherscanApi = (url: URL, res: http.ServerResponse): void => {
    const action = url.searchParams.get("action");
    if (action === "getcontractcreation") {
      const contractAddresses = url.searchParams.get("contractaddresses") ?? "";
      const entry = byAddress.get(contractAddresses.toLowerCase());
      if (entry?.creatorTxHash) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "1",
            message: "OK",
            result: [
              {
                contractAddress: entry.address,
                txHash: entry.creatorTxHash,
              },
            ],
          }),
        );
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ status: "0", message: "No data found", result: "" }),
        );
      }
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: "unknown action" }));
  };

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);

      if (req.method === "GET" && url.pathname === "/api") {
        handleEtherscanApi(url, res);
        return;
      }

      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const json = JSON.parse(body);
          const response = Array.isArray(json)
            ? json.map(handleRpcRequest)
            : handleRpcRequest(json);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
        } catch (e) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
};

export const stopMockRpcServer = (server: http.Server): Promise<void> =>
  new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
