import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import semver from 'semver';
import {
  CompilerError,
  createCompilerTimeoutError,
  DEFAULT_COMPILE_TIMEOUT_MS,
  fetchWithBackoff,
  resolveCompilerPath,
} from './common';
import { logDebug, logError, logInfo, logWarn } from '../logger';
import type { FeJsonInput, FeOutput } from '@ethereum-sourcify/compilers-types';
import type { JsonFragment } from 'ethers';

const HOST_FE_REPO = 'https://github.com/argotorg/fe/releases/download/';
const MINIMUM_FE_VERSION = '26.0.0-alpha.12';

/**
 * Resolve a Fe source key under `root`. The key must name a `.fe` file under
 * `<root>/src/`. Other keys could replace `fe.toml` or walk out of the ingot.
 */
export function resolveFeSourcePath(root: string, sourcePath: string): string {
  if (sourcePath.includes('\0')) {
    throw new Error(`Fe source path contains a null byte: ${sourcePath}`);
  }
  if (path.isAbsolute(sourcePath)) {
    throw new Error(`Fe source path must be relative: ${sourcePath}`);
  }
  const resolved = path.resolve(root, sourcePath);
  const srcDir = path.join(path.resolve(root), 'src') + path.sep;
  if (!resolved.startsWith(srcDir) || !resolved.endsWith('.fe')) {
    throw new Error(
      `Fe source path must be a .fe file under src/: ${sourcePath}`,
    );
  }
  return resolved;
}

/**
 * Returns the platform-specific asset name for the Fe binary.
 * Asset names follow the pattern: fe_{os}_{arch}[.exe]
 */
export function findFePlatform(): string | false {
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return 'fe_mac_amd64';
    if (process.arch === 'arm64') return 'fe_mac_arm64';
  }
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return 'fe_linux_amd64';
    if (process.arch === 'arm64') return 'fe_linux_arm64';
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'fe_windows_amd64.exe';
  }
  return false;
}

/**
 * Returns the path to the Fe executable for the given version,
 * downloading it if not already cached.
 */
export async function getFeExecutable(
  feRepoPath: string,
  platform: string,
  version: string,
): Promise<string> {
  const fileName = `fe-${version}-${platform}`;
  const fePath = resolveCompilerPath(feRepoPath, fileName);
  if (validateFePath(fePath)) {
    return fePath;
  }
  await fetchAndSaveFe(platform, fePath, version);

  if (!validateFePath(fePath)) {
    throw new Error(
      `Fe compiler not found. Maybe an incorrect version was provided. ${fePath} - ${version} - ${platform}`,
    );
  }
  return fePath;
}

function validateFePath(fePath: string): boolean {
  if (!fs.existsSync(fePath)) {
    logDebug('Fe binary not found', { fePath });
    return false;
  }
  const spawned = spawnSync(fePath, ['--version']);
  if (spawned.status === 0) {
    logDebug('Found Fe binary', { fePath });
    return true;
  }
  const error =
    spawned?.error?.message ||
    spawned.stderr?.toString() ||
    'Error running Fe binary, are you on the right platform?';
  logWarn(error);
  return false;
}

async function fetchAndSaveFe(
  platform: string,
  fePath: string,
  version: string,
): Promise<void> {
  const githubFeURI = `${HOST_FE_REPO}v${version}/${platform}`;
  logDebug('Fetching Fe compiler', { version, platform, fePath, githubFeURI });

  const res = await fetchWithBackoff(githubFeURI);
  const status = res.status;
  const buffer = await res.arrayBuffer();

  if (status === 200 && buffer) {
    logDebug('Fetched Fe compiler', { version, platform, fePath });
    fs.mkdirSync(path.dirname(fePath), { recursive: true });
    try {
      fs.unlinkSync(fePath);
    } catch (_e) {
      undefined;
    }
    fs.writeFileSync(fePath, new DataView(buffer), { mode: 0o755 });
    return;
  }

  logError('Failed fetching Fe compiler', {
    version,
    platform,
    fePath,
    githubFeURI,
  });
  throw new Error(
    `Failed fetching Fe ${version} for platform ${platform}. Please check if the version is valid.`,
  );
}

/**
 * Compiles Fe source files by:
 * 1. Scaffolding a unique temp ingot directory
 * 2. Running `fe build`
 * 3. Reading bytecode artifacts from `out/`
 * 4. Cleaning up
 *
 * @param timeoutMs wall-clock limit for the `fe build` subprocess, after which
 *   it is SIGKILLed. Defaults to DEFAULT_COMPILE_TIMEOUT_MS.
 */
export async function useFeCompiler(
  feRepoPath: string,
  version: string,
  feJsonInput: FeJsonInput,
  timeoutMs: number = DEFAULT_COMPILE_TIMEOUT_MS,
): Promise<FeOutput> {
  // semver.valid trims whitespace. Require the exact version string.
  if (
    semver.valid(version) !== version ||
    semver.lt(version, MINIMUM_FE_VERSION)
  ) {
    throw new Error(
      `Fe compiler version ${version} is not supported. Minimum supported version is ${MINIMUM_FE_VERSION}.`,
    );
  }

  const fePlatform = findFePlatform();
  if (!fePlatform) {
    throw new Error('Fe compiler is not supported on this machine.');
  }

  const fePath = await getFeExecutable(feRepoPath, fePlatform, version);

  // Create a unique temp directory to avoid collisions from parallel compilations
  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'fe-compilation-'),
  );

  try {
    // Check all source keys before the first write.
    // sourcePaths already have the src/ prefix, e.g. 'src/lib.fe'.
    const sourceFiles = Object.entries(feJsonInput.sources).map(
      ([sourcePath, source]) => ({
        fullPath: resolveFeSourcePath(tmpDir, sourcePath),
        content: source.content,
      }),
    );
    for (const { fullPath, content } of sourceFiles) {
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, content);
    }

    // Write the manifest last. No source file can replace it.
    const feToml = `[ingot]\nname = "sourcify_verification"\nversion = "0.1.0"\n`;
    await fs.promises.writeFile(path.join(tmpDir, 'fe.toml'), feToml);

    // Give fe a home inside tmpDir. The cleanup below deletes its caches.
    const feHome = path.join(tmpDir, '.home');
    await fs.promises.mkdir(feHome);
    // Keep the env small. FE_CACHE_DIR and FE_REMOTE_CACHE_DIR stay unset.
    const feEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '',
      HOME: feHome,
      USERPROFILE: feHome,
      XDG_CACHE_HOME: path.join(feHome, '.cache'),
    };
    for (const name of ['SystemRoot', 'TEMP', 'TMP', 'TMPDIR']) {
      const value = process.env[name];
      if (value !== undefined) {
        feEnv[name] = value;
      }
    }

    // Run fe build
    const startCompilation = Date.now();
    // spawnSync blocks this thread until fe exits, so a timer could never fire
    // here: its own timeout option is the only way to bound a hung compile and
    // free the verification worker slot (#2880).
    const spawned = spawnSync(fePath, ['build', tmpDir], {
      cwd: tmpDir,
      env: feEnv,
      maxBuffer: 250 * 1024 * 1024,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    const endCompilation = Date.now();
    logInfo('Fe compilation done', {
      timeInMs: endCompilation - startCompilation,
    });

    // On timeout spawnSync reports ETIMEDOUT and leaves status null, so this
    // has to be checked before the generic non-zero-exit handling below.
    if (
      (spawned.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
    ) {
      logWarn('Fe compiler timed out', { version, timeoutMs });
      throw createCompilerTimeoutError(timeoutMs);
    }

    if (spawned.status !== 0) {
      const stderr = spawned.stderr?.toString() || '';
      const errorMessage =
        spawned.error?.message || stderr || 'Compilation failed';
      logError('Fe compiler error', { errorMessage });
      throw new CompilerError('Fe compiler error', [
        {
          severity: 'error',
          message: errorMessage,
          type: 'CompilerError',
          component: 'general',
          formattedMessage: errorMessage,
        },
      ]);
    }

    // Read output files from out/
    const outDir = path.join(tmpDir, 'out');
    const outFiles = await fs.promises.readdir(outDir);

    const contracts: FeOutput['contracts'] = {};

    // Group by contract name (.bin and .runtime.bin)
    const contractNames = new Set<string>();
    for (const file of outFiles) {
      if (file.endsWith('.bin') && !file.endsWith('.runtime.bin')) {
        contractNames.add(file.slice(0, -4)); // strip .bin
      }
    }

    // Build contractName → sourcePath map by scanning source files for "pub contract Name"
    const contractToSourcePath: Record<string, string> = {};
    for (const [sourcePath, source] of Object.entries(feJsonInput.sources)) {
      const matches = source.content.matchAll(/pub\s+contract\s+(\w+)/g);
      for (const match of matches) {
        contractToSourcePath[match[1]] = sourcePath;
      }
    }

    for (const contractName of contractNames) {
      const binPath = path.join(outDir, `${contractName}.bin`);
      const runtimeBinPath = path.join(outDir, `${contractName}.runtime.bin`);

      const creationBytecode = (
        await fs.promises.readFile(binPath, 'utf8')
      ).trim();
      const runtimeBytecode = (
        await fs.promises.readFile(runtimeBinPath, 'utf8')
      ).trim();

      // Map back to the source path using regex scan; fallback to first source
      const sourcePath =
        contractToSourcePath[contractName] ??
        Object.keys(feJsonInput.sources)[0];
      // Read ABI (always present for supported Fe versions >= 26.0.0-alpha.12)
      const abiPath = path.join(outDir, `${contractName}.abi.json`);
      const abiContent = await fs.promises.readFile(abiPath, 'utf8');
      const abi: JsonFragment[] = JSON.parse(abiContent.trim());

      if (!contracts[sourcePath]) {
        contracts[sourcePath] = {};
      }
      contracts[sourcePath][contractName] = {
        abi,
        evm: {
          bytecode: { object: creationBytecode },
          deployedBytecode: { object: runtimeBytecode },
        },
      };
    }

    return {
      compiler: `fe-${version}`,
      contracts,
    };
  } finally {
    // Always clean up the temp directory
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  }
}
