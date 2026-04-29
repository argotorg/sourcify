import http from "http";
import etherscanBytecodes from "./etherscanBytecodes.json";

/**
 * Real local HTTP server that responds to JSON-RPC eth_getCode for a given chain,
 * sourcing bytecodes from etherscanBytecodes.json. Real (not nock) because v2
 * verification runs in a Piscina worker thread, and nock's HTTP-module patches
 * don't propagate across thread boundaries.
 */
export const startMockRpcServer = (
  chainId: string,
  port: number,
): Promise<http.Server> => {
  const chainBytecodes =
    (etherscanBytecodes as Record<string, Record<string, string>>)[chainId] ??
    {};

  const handleRequest = (req: { method: string; params: any[]; id: any }) => {
    let result: string | null = null;
    if (req.method === "eth_getCode") {
      const reqAddress = (req.params[0] as string).toLowerCase();
      result =
        Object.entries(chainBytecodes).find(
          ([k]) => k.toLowerCase() === reqAddress,
        )?.[1] ?? "0x";
    }
    return { jsonrpc: "2.0", id: req.id, result };
  };

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        try {
          const json = JSON.parse(body);
          const response = Array.isArray(json)
            ? json.map(handleRequest)
            : handleRequest(json);
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
