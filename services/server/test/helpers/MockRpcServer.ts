import http from "http";
import type { AddressInfo } from "net";

/**
 * A minimal JSON-RPC server that replays captured `eth_*` responses. Used to
 * mock a SourcifyChain over real HTTP so the verification worker (which runs in
 * a separate thread and can't be intercepted by nock) can read on-chain data
 * from a deterministic fixture instead of a live RPC.
 *
 * `responses` maps a JSON-RPC method to its captured `result`. A few methods
 * fall back to sensible defaults so ethers' provider bootstrapping doesn't fail.
 */
export class MockRpcServer {
  private server?: http.Server;
  private readonly chainIdHex: string;

  constructor(
    private readonly responses: Record<string, unknown>,
    chainId: number,
  ) {
    this.chainIdHex = "0x" + chainId.toString(16);
  }

  get url(): string {
    if (!this.server) throw new Error("MockRpcServer not started");
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  private resultFor(method: string): unknown {
    if (method in this.responses) {
      return this.responses[method];
    }
    switch (method) {
      case "eth_chainId":
      case "net_version":
        return this.chainIdHex;
      case "eth_blockNumber":
        return "0x1";
      default:
        return null;
    }
  }

  private handleSingle(req: { id: unknown; method: string }) {
    return {
      jsonrpc: "2.0",
      id: req.id,
      result: this.resultFor(req.method),
    };
  }

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        let payload: any;
        try {
          payload = JSON.parse(body);
        } catch {
          res.writeHead(400).end();
          return;
        }
        const response = Array.isArray(payload)
          ? payload.map((p) => this.handleSingle(p))
          : this.handleSingle(payload);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(response));
      });
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(0, "127.0.0.1", resolve);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = undefined;
  }
}
