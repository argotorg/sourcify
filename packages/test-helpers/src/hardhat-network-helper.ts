import path from "path";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import treeKill from "tree-kill";

export interface StartHardhatNetworkOptions {
  chainId?: number;
  miningInterval?: number;
}

const RUNNER_DIR = path.resolve(__dirname, "..", "hardhat-runner");

export function startHardhatNetwork(
  port: number,
  options: StartHardhatNetworkOptions = {},
) {
  return new Promise<ChildProcess>((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (options.chainId !== undefined) {
      env.HARDHAT_TEST_CHAIN_ID = String(options.chainId);
    }
    if (options.miningInterval !== undefined) {
      env.HARDHAT_TEST_MINING_INTERVAL = String(options.miningInterval);
    }

    const hardhatNodeProcess = spawn(
      "npx",
      ["hardhat", "node", "--port", port.toString()],
      { cwd: RUNNER_DIR, env },
    );

    hardhatNodeProcess.stderr.on("data", (data: Buffer) => {
      console.error(`Hardhat Network Error: ${data.toString()}`);
    });

    hardhatNodeProcess.stdout.on("data", (data: Buffer) => {
      if (
        data
          .toString()
          .includes("Started HTTP and WebSocket JSON-RPC server at")
      ) {
        resolve(hardhatNodeProcess);
      }
    });
  });
}

export function stopHardhatNetwork(hardhatNodeProcess: ChildProcess) {
  return new Promise<void>((resolve, reject) => {
    treeKill(hardhatNodeProcess.pid!, "SIGTERM", (err) => {
      if (err) {
        console.error(`Failed to kill process tree: ${err}`);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
