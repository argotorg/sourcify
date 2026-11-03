import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type { ReadableStream as WebReadableStream } from "stream/web";

const execFileAsync = promisify(execFile);

export const FOUNDRY_TAG = "v1.9.0";
// The Solar that Foundry v1.9.0 bundles, one commit before Solar v0.3.0
export const FOUNDRY_SOLAR_VERSION = "0.8.38+commit.a2b44354.solar.0.3.0-dev";

const COUNTER_SOURCE = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

contract Counter {
    uint256 public number;

    function setNumber(uint256 newNumber) public {
        number = newNumber;
    }

    function increment() public {
        number++;
    }
}
`;

export type FoundryProject = {
  root: string;
  creationBytecode: string;
  // The build info that `forge build --build-info` writes
  buildInfo: { input: any; solcLongVersion: string };
};

function foundryPlatform(): string {
  const platforms: Record<string, string> = {
    "linux-x64": "linux_amd64",
    "linux-arm64": "linux_arm64",
    "darwin-x64": "darwin_amd64",
    "darwin-arm64": "darwin_arm64",
  };
  const platform = platforms[`${process.platform}-${process.arch}`];
  if (!platform) {
    throw new Error(`No Foundry release for ${process.platform}`);
  }
  return platform;
}

/** Downloads forge and its bundled solar like foundryup, reused across runs */
export async function downloadFoundry(): Promise<string> {
  const dir = path.join(os.tmpdir(), `sourcify-test-foundry-${FOUNDRY_TAG}`);
  const forge = path.join(dir, "forge");
  const solar = path.join(dir, "solar");
  if (fs.existsSync(forge) && fs.existsSync(solar)) {
    return dir;
  }
  fs.mkdirSync(dir, { recursive: true });
  const url = `https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY_TAG}/foundry_${FOUNDRY_TAG}_${foundryPlatform()}.tar.gz`;
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${url}: ${res.status}`);
  }
  const archive = path.join(dir, "foundry.tar.gz");
  await pipeline(
    Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
    fs.createWriteStream(archive),
  );
  await execFileAsync("tar", ["-xzf", archive, "-C", dir, "forge", "solar"]);
  fs.rmSync(archive);
  return dir;
}

/** Runs forge with the bundled solar first on PATH, as after foundryup */
export function runForge(foundryDir: string, cwd: string, args: string[]) {
  return execFileAsync(path.join(foundryDir, "forge"), args, {
    cwd,
    env: {
      ...process.env,
      PATH: `${foundryDir}${path.delimiter}${process.env.PATH}`,
    },
    maxBuffer: 50 * 1024 * 1024,
  });
}

/** Creates a Foundry project with a Counter contract and builds it with Solar */
export async function createFoundryProject(
  foundryDir: string,
): Promise<FoundryProject> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sourcify-foundry-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(
    path.join(root, "foundry.toml"),
    '[profile.default]\nsrc = "src"\nout = "out"\nlibs = []\n',
  );
  fs.writeFileSync(path.join(root, "src", "Counter.sol"), COUNTER_SOURCE);
  await runForge(foundryDir, root, ["build", "--use", "solar", "--build-info"]);

  const out = path.join(root, "out");
  const artifact = JSON.parse(
    fs.readFileSync(path.join(out, "Counter.sol", "Counter.json"), "utf8"),
  );
  const [buildInfoFile] = fs.readdirSync(path.join(out, "build-info"));
  const buildInfo = JSON.parse(
    fs.readFileSync(path.join(out, "build-info", buildInfoFile), "utf8"),
  );
  return { root, creationBytecode: artifact.bytecode.object, buildInfo };
}
