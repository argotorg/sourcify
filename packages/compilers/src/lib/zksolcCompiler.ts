// See ZKSOLC.md in this package for the compiler model
// (zksolc vs era-solc vs upstream solc, the 1.5.0 split, gnu/musl).
// TODO: Handle nodejs only dependencies
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import semver from 'semver';
import { logDebug, logError, logInfo, logWarn } from '../logger';
import { CompilerError, fetchWithBackoff } from './common';
import { findSolcPlatform, getSolcExecutable } from './solidityCompiler';
import type {
  SolidityJsonInput,
  SolidityOutput,
} from '@ethereum-sourcify/compilers-types';

const HOST_ZKSOLC_REPO =
  'https://github.com/matter-labs/era-compiler-solidity/releases/download/';
const HOST_LEGACY_ZKSOLC_REPO =
  'https://github.com/matter-labs/zksolc-bin/releases/download/';
const HOST_ERA_SOLC_REPO =
  'https://github.com/matter-labs/era-solidity/releases/download/';
const ERA_SOLC_VERSION_REGEX = /^v?(?:zkVM-)?\d+\.\d+\.\d+-1\.0\.[0-2]$/;
const SOLC_RELEASE_VERSION_REGEX =
  /^v?\d+\.\d+\.\d+(?:\+commit\.[a-fA-F0-9]+)?$/;

function stripLeadingV(version: string): string {
  return version.trim().replace(/^v/, '');
}

export function normalizeZkSolcVersion(version: string): string {
  if (version.startsWith('vm-')) {
    return version;
  }
  return `v${stripLeadingV(version)}`;
}

export function normalizeEraSolcVersion(version: string): string {
  return stripLeadingV(version).replace(/^zkVM-/, '');
}

export function isZkSolcVersionAtLeastV15(version: string): boolean {
  // Pre-release of 1.5.0 (git-SHA suffix). semver.parse rejects it; without
  // this guard the unparseable-default below would treat it as ≥ 1.5, when in
  // fact it predates the 1.5.0 release and must use the pre-1.5 CLI shape.
  if (version === 'vm-1.5.0-a167aa3') {
    return false;
  }
  const parsedVersion = semver.parse(stripLeadingV(version));
  if (!parsedVersion) {
    return true;
  }
  return semver.gte(parsedVersion, '1.5.0');
}

export function findZkSolcPlatform(): string | false {
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return 'macosx-amd64';
    if (process.arch === 'arm64') return 'macosx-arm64';
  }
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return 'linux-amd64-gnu';
    if (process.arch === 'arm64') return 'linux-arm64-gnu';
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    // Matter Labs publishes the Windows zksolc as a MinGW build; the -gnu
    // suffix is part of the upstream filename, not a libc choice.
    return 'windows-amd64-gnu';
  }
  return false;
}

export function findEraSolcPlatform(): string | false {
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return 'macosx-amd64';
    if (process.arch === 'arm64') return 'macosx-arm64';
  }
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return 'linux-amd64';
    if (process.arch === 'arm64') return 'linux-arm64';
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'windows-amd64';
  }
  return false;
}

export async function useZkSolcCompiler(
  zksolcRepoPath: string,
  eraSolcRepoPath: string,
  zksolcVersion: string,
  solcVersion: string,
  solcJsonInput: SolidityJsonInput,
  solcRepoPath?: string,
): Promise<SolidityOutput> {
  const zksolcPlatform = findZkSolcPlatform();
  if (!zksolcPlatform) {
    throw new Error('zksolc is not supported on this machine.');
  }

  const eraSolcPlatform = findEraSolcPlatform();
  if (!eraSolcPlatform) {
    throw new Error('EraVM solc is not supported on this machine.');
  }

  const zksolcPath = await getZkSolcExecutable(
    zksolcRepoPath,
    zksolcPlatform,
    zksolcVersion,
  );
  const solcPath = await getZkSolcBaseSolcExecutable(
    eraSolcRepoPath,
    eraSolcPlatform,
    solcVersion,
    solcRepoPath,
  );

  const inputStringified = JSON.stringify(solcJsonInput);
  const compileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sourcify-zksolc-'));
  const startCompilation = Date.now();
  let compiled: string | undefined;
  try {
    compiled = await spawnCompiler(
      zksolcPath,
      getZkSolcStandardJsonArgs(
        zksolcVersion,
        solcPath,
        compileDir,
        solcJsonInput,
      ),
      inputStringified,
    );
  } finally {
    fs.rmSync(compileDir, { recursive: true, force: true });
  }
  const endCompilation = Date.now();
  logInfo('Local compiler - Compilation done', {
    compiler: 'zksolc',
    timeInMs: endCompilation - startCompilation,
  });

  if (!compiled) {
    throw new Error('Compilation failed. No output from the compiler.');
  }
  const compiledJSON = JSON.parse(compiled) as SolidityOutput;
  const errorMessages = compiledJSON?.errors?.filter(
    (e) => e.severity === 'error',
  );
  if (errorMessages && errorMessages.length > 0) {
    logError('Compiler error', {
      errorMessages,
    });
    throw new CompilerError('Compiler error', errorMessages);
  }
  return compiledJSON;
}

export async function getZkSolcBaseSolcExecutable(
  eraSolcRepoPath: string,
  eraSolcPlatform: string,
  solcVersion: string,
  solcRepoPath?: string,
): Promise<string> {
  if (ERA_SOLC_VERSION_REGEX.test(solcVersion)) {
    return getEraSolcExecutable(eraSolcRepoPath, eraSolcPlatform, solcVersion);
  }

  if (SOLC_RELEASE_VERSION_REGEX.test(solcVersion) && solcRepoPath) {
    return getUpstreamSolcExecutable(solcRepoPath, solcVersion);
  }

  return getEraSolcExecutable(eraSolcRepoPath, eraSolcPlatform, solcVersion);
}

async function getUpstreamSolcExecutable(
  solcRepoPath: string,
  solcVersion: string,
): Promise<string> {
  const normalizedVersion = stripLeadingV(solcVersion);
  const solcPlatforms = getUpstreamSolcPlatformCandidates();

  for (const solcPlatform of solcPlatforms) {
    try {
      const solcPath = await getSolcExecutable(
        solcRepoPath,
        solcPlatform,
        normalizedVersion,
      );
      if (solcPath) {
        return solcPath;
      }
    } catch (error) {
      logWarn('Failed to resolve native solc for zksolc', {
        solcVersion,
        solcPlatform,
        error,
      });
    }
  }

  throw new Error(
    `Unsupported upstream solc platform for zksolc: ${solcVersion}`,
  );
}

function getUpstreamSolcPlatformCandidates(): string[] {
  const nativePlatform = findSolcPlatform();
  if (nativePlatform) {
    return [nativePlatform];
  }

  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return ['macosx-amd64'];
  }

  return [];
}

export function getZkSolcStandardJsonArgs(
  zksolcVersion: string,
  eraSolcPath: string,
  allowedPath: string,
  solcJsonInput: SolidityJsonInput,
): string[] {
  const args = ['--standard-json', '--solc', eraSolcPath];
  const settings = solcJsonInput.settings as SolidityJsonInput['settings'] & {
    isSystem?: boolean;
    forceEvmla?: boolean;
    enableEraVMExtensions?: boolean;
    forceEVMLA?: boolean;
  };

  if (!isZkSolcVersionAtLeastV15(zksolcVersion)) {
    if (settings.enableEraVMExtensions || settings.isSystem) {
      args.push('--system-mode');
    }
    if (settings.forceEVMLA || settings.forceEvmla) {
      args.push('--force-evmla');
    }
  }

  args.push('--allow-paths', allowedPath);
  return args;
}

export async function getZkSolcExecutable(
  zksolcRepoPath: string,
  platform: string,
  version: string,
): Promise<string> {
  const normalizedVersion = normalizeZkSolcVersion(version);
  const candidateFileNames = getZkSolcFileNameCandidates(
    platform,
    normalizedVersion,
  );

  for (const fileName of candidateFileNames) {
    const zksolcPath = path.join(zksolcRepoPath, fileName);
    if (validateCompilerPath(zksolcPath, 'zksolc')) {
      return zksolcPath;
    }
  }

  let lastError: unknown;
  for (const fileName of candidateFileNames) {
    const zksolcPath = path.join(zksolcRepoPath, fileName);
    try {
      await fetchAndSaveCompiler(
        HOST_ZKSOLC_REPO,
        normalizedVersion,
        zksolcPath,
        fileName,
      );
    } catch (primaryError) {
      logDebug('Failed to resolve zksolc from era-compiler-solidity', {
        fileName,
        version: normalizedVersion,
        error: primaryError,
      });

      try {
        await fetchAndSaveCompiler(
          HOST_LEGACY_ZKSOLC_REPO,
          normalizedVersion,
          zksolcPath,
          fileName,
          false,
        );
      } catch (legacyError) {
        lastError = legacyError;
        logDebug('Failed to resolve zksolc from legacy zksolc-bin', {
          fileName,
          version: normalizedVersion,
          error: legacyError,
        });
        continue;
      }
    }

    try {
      if (validateCompilerPath(zksolcPath, 'zksolc')) {
        return zksolcPath;
      }
      throw new Error(
        `Downloaded zksolc is not executable. ${zksolcPath} - ${normalizedVersion} - ${platform}`,
      );
    } catch (error) {
      lastError = error;
      logDebug('Failed to resolve zksolc candidate', {
        fileName,
        version: normalizedVersion,
        error,
      });
    }
  }

  throw new Error(
    `zksolc not found. Maybe an incorrect version was provided. ${normalizedVersion} - ${platform}. Last error: ${lastError}`,
  );
}

export async function getEraSolcExecutable(
  eraSolcRepoPath: string,
  platform: string,
  version: string,
): Promise<string> {
  const normalizedVersion = normalizeEraSolcVersion(version);
  const fileName = getEraSolcFileName(platform, normalizedVersion);
  const eraSolcPath = path.join(eraSolcRepoPath, fileName);
  if (validateCompilerPath(eraSolcPath, 'era-solc')) {
    return eraSolcPath;
  }

  await fetchAndSaveCompiler(
    HOST_ERA_SOLC_REPO,
    normalizedVersion,
    eraSolcPath,
    fileName,
  );

  if (!validateCompilerPath(eraSolcPath, 'era-solc')) {
    throw new Error(
      `EraVM solc not found. Maybe an incorrect version was provided. ${eraSolcPath} - ${normalizedVersion} - ${platform}`,
    );
  }
  return eraSolcPath;
}

// Linux zksolc ships in two libc flavors: -gnu (glibc; most distros) and
// -musl (Alpine, etc.). Return both so the caller can fall back if needed.
function getZkSolcFileNameCandidates(
  platform: string,
  normalizedVersion: string,
): string[] {
  const primary = getZkSolcFileName(platform, normalizedVersion);
  if (platform.endsWith('-gnu')) {
    const musl = getZkSolcFileName(
      platform.replace(/-gnu$/, '-musl'),
      normalizedVersion,
    );
    return [primary, musl];
  }
  return [primary];
}

function getZkSolcFileName(
  platform: string,
  normalizedVersion: string,
): string {
  const extension = platform.startsWith('windows-') ? '.exe' : '';
  return `zksolc-${platform}-${normalizedVersion}${extension}`;
}

function getEraSolcFileName(
  platform: string,
  normalizedVersion: string,
): string {
  const extension = platform.startsWith('windows-') ? '.exe' : '';
  return `solc-${platform}-${normalizedVersion}${extension}`;
}

function validateCompilerPath(compilerPath: string, compiler: string): boolean {
  if (!fs.existsSync(compilerPath)) {
    logDebug(`${compiler} binary not found`, {
      compilerPath,
    });
    return false;
  }

  const spawned = spawnSync(compilerPath, ['--version']);
  if (spawned.status === 0) {
    logDebug(`Found ${compiler} binary`, {
      compilerPath,
    });
    return true;
  }

  const error =
    spawned?.error?.message ||
    spawned.stderr.toString() ||
    `Error running ${compiler}, are you on the right platform?`;

  logWarn(error);
  return false;
}

async function fetchAndSaveCompiler(
  host: string,
  version: string,
  compilerPath: string,
  fileName: string,
  stripTagVersionV = true,
): Promise<void> {
  const releaseTag = stripTagVersionV ? stripLeadingV(version) : version;
  const encodedURIFilename = encodeURIComponent(fileName);
  const githubCompilerURI = `${host}${releaseTag}/${encodedURIFilename}`;
  logInfo('Fetching compiler', {
    version,
    githubCompilerURI,
    compilerPath,
  });

  const res = await fetchWithBackoff(githubCompilerURI);
  const status = res.status;
  const buffer = await res.arrayBuffer();

  if (status === 200 && buffer) {
    fs.mkdirSync(path.dirname(compilerPath), { recursive: true });

    try {
      fs.unlinkSync(compilerPath);
    } catch (_e) {
      undefined;
    }
    fs.writeFileSync(compilerPath, new DataView(buffer), { mode: 0o755 });
    logInfo('Saved compiler', {
      version,
      githubCompilerURI,
      compilerPath,
    });
    return;
  }

  logError('Failed fetching compiler', {
    version,
    githubCompilerURI,
    compilerPath,
  });
  throw new Error(
    `Failed fetching compiler ${version}. Please check if the version is valid.`,
  );
}

function spawnCompiler(
  compilerPath: string,
  args: string[],
  inputStringified: string,
): Promise<string> {
  JSON.parse(inputStringified);

  return new Promise((resolve, reject) => {
    const child = spawn(compilerPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdinError: Error | undefined;
    let settled = false;

    function settle<T>(callback: (value: T) => void, value: T): void {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    }

    child.stdout.on('data', (data) => stdout.push(data));
    child.stderr.on('data', (data) => stderr.push(data));
    child.once('error', (error) => settle(reject, error));
    child.once('close', (code) => {
      const stdoutString = Buffer.concat(stdout).toString();
      const stderrString = Buffer.concat(stderr).toString();
      if (code === 0) {
        settle(resolve, stdoutString);
      } else {
        settle(
          reject,
          new Error(
            `Compiler process returned with code ${code}:\n ${
              stderrString || stdinError?.message || ''
            }`,
          ),
        );
      }
    });

    if (!child.stdin) {
      throw new Error('No stdin on child process');
    }
    child.stdin.on('error', (error) => {
      stdinError = error;
      if ((error as NodeJS.ErrnoException).code !== 'EPIPE') {
        settle(reject, error);
      }
    });
    child.stdin.end(inputStringified);
  });
}
