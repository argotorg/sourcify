import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { threadId } from 'worker_threads';
import { asyncExec, CompilerError, fetchWithBackoff } from './common';
import { logDebug, logError, logInfo, logWarn } from '../logger';
import { parseSlangVersion } from '@ethereum-sourcify/compilers-types';
import type {
  SlangJsonInput,
  SlangOutput,
} from '@ethereum-sourcify/compilers-types';

// Mirror of the Slang assets on the NomicFoundation/solx GitHub releases
const HOST_SLANG_RELEASES = 'https://solx-releases-mirror.hardhat.org/';

// The platform part of the Slang asset name for this machine
export function findSlangPlatform(): string | false {
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return 'linux-amd64-gnu';
    if (process.arch === 'arm64') return 'linux-arm64-gnu';
  }
  // One universal binary for Intel and Apple silicon
  if (process.platform === 'darwin') return 'macosx';
  return false;
}

// Compiles in standard JSON mode. The version ends with +slang, e.g. 0.2.0+slang
export async function useSlangCompiler(
  slangRepoPath: string,
  version: string,
  slangJsonInput: SlangJsonInput,
  timeoutMs?: number,
): Promise<SlangOutput> {
  const parsedVersion = parseSlangVersion(version);
  if (!parsedVersion) {
    throw new Error(`Invalid Slang version: ${version}`);
  }
  const slangPlatform = findSlangPlatform();
  if (!slangPlatform) {
    throw new Error('Slang is not supported on this machine.');
  }

  const slangPath = await getSlangExecutable(
    slangRepoPath,
    slangPlatform,
    parsedVersion.slangVersion,
  );

  // Absolute path: asyncExec runs in a temp cwd (#2920), breaking relative paths.
  const absoluteSlangPath = path.resolve(slangPath);
  const startCompilation = Date.now();
  let compiled: string;
  try {
    compiled = await asyncExec(
      `${absoluteSlangPath} --standard-json`,
      JSON.stringify(slangJsonInput),
      250 * 1024 * 1024,
      timeoutMs,
    );
  } catch (error: any) {
    if (error?.code === 'ENOBUFS') {
      throw new Error('Compilation output size too large');
    }
    logWarn(error.message);
    throw error;
  }
  logInfo('Local compiler - Compilation done', {
    compiler: 'slang',
    timeInMs: Date.now() - startCompilation,
  });

  if (!compiled) {
    throw new Error('Compilation failed. No output from the compiler.');
  }
  // Slang always exits with code 0 and reports errors in the output
  const compiledJSON = JSON.parse(compiled) as SlangOutput;
  const errorMessages = compiledJSON?.errors?.filter(
    (e) => e.severity === 'error',
  );
  if (errorMessages && errorMessages.length > 0) {
    logError('Compiler error', { errorMessages });
    throw new CompilerError('Compiler error', errorMessages);
  }
  return compiledJSON;
}

// Returns the cached binary of the version, or downloads the release
export async function getSlangExecutable(
  slangRepoPath: string,
  platform: string,
  slangVersion: string,
): Promise<string> {
  const fileName = `slang-${platform}-v${slangVersion}`;
  const slangPath = path.join(slangRepoPath, fileName);
  if (fs.existsSync(slangPath)) {
    try {
      assertSlangBuild(slangPath, slangVersion);
      logDebug('Found existing Slang binary', { slangPath });
      return slangPath;
    } catch (error: any) {
      // Replace a wrong or broken cached binary, as the solc and vyper paths do
      logWarn(
        'Cached Slang binary is not the requested build, downloading again',
        {
          slangPath,
          error: error.message,
        },
      );
      fs.rmSync(slangPath, { force: true });
    }
  }

  // Unique temp name: worker threads share the pid and must not run a half-written binary
  const tmpPath = `${slangPath}.${process.pid}.${threadId}.${randomUUID()}.tmp`;
  await fetchAndSaveSlangAsset(fileName, tmpPath);
  try {
    assertSlangBuild(tmpPath, slangVersion);
    fs.renameSync(tmpPath, slangPath);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
  return slangPath;
}

// A pre-release can report another version, so only a release is compared
function assertSlangBuild(slangPath: string, slangVersion: string) {
  const spawned = spawnSync(slangPath, ['--version']);
  if (spawned.status !== 0) {
    const error =
      spawned?.error?.message ||
      spawned.stderr?.toString() ||
      'Error running Slang binary, are you on the right platform?';
    throw new Error(`Cannot run Slang binary ${slangPath}: ${error}`);
  }
  // The first line is e.g. `slang v0.2.0, LLVM-based Solidity compiler for the EVM, ...`
  const firstLine = spawned.stdout.toString().split('\n')[0].trim();
  const reported = /^slang v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?),/.exec(
    firstLine,
  )?.[1];
  const isPreRelease = slangVersion.includes('-');
  if (!reported || (!isPreRelease && reported !== slangVersion)) {
    throw new Error(
      `Slang ${slangVersion} not found: the binary reports "${firstLine}"`,
    );
  }
}

// Downloads one asset of the Slang releases and checks its SHA-256
export async function fetchAndSaveSlangAsset(
  assetName: string,
  slangPath: string,
): Promise<void> {
  const slangURI = `${HOST_SLANG_RELEASES}${encodeURIComponent(assetName)}`;
  logInfo('Fetching Slang', { slangURI, slangPath });

  // Each asset has a sidecar file in the format of sha256sum
  const checksumRes = await fetchWithBackoff(`${slangURI}.sha256`);
  const res = await fetchWithBackoff(slangURI);
  if (checksumRes.status !== 200 || res.status !== 200) {
    logError('Failed fetching Slang', { slangURI });
    throw new Error(
      `Failed fetching ${assetName}. Please check if the version is valid.`,
    );
  }
  const expectedChecksum = (await checksumRes.text())
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
  const binary = Buffer.from(await res.arrayBuffer());
  const checksum = createHash('sha256').update(binary).digest('hex');
  if (checksum !== expectedChecksum) {
    logError('Slang checksum mismatch', { slangURI, checksum });
    throw new Error(`The checksum of ${assetName} does not match.`);
  }
  fs.mkdirSync(path.dirname(slangPath), { recursive: true });
  fs.writeFileSync(slangPath, binary, { mode: 0o755 });
  logInfo('Saved Slang', { slangURI, slangPath });
}
