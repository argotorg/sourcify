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
import type {
  FeJsonInput,
  FeMetadataSettings,
  FeOutput,
} from '@ethereum-sourcify/compilers-types';
import type { JsonFragment } from 'ethers';

const HOST_FE_REPO = 'https://github.com/argotorg/fe/releases/download/';
const MINIMUM_FE_VERSION = '26.0.0-alpha.12';
/** First Fe release with `fe build --from-metadata`. */
export const MINIMUM_FE_METADATA_VERSION = '26.3.0';

/**
 * True if the input carries the `settings` of Fe metadata
 * (`fe build --emit metadata`) and is compiled with `--from-metadata`.
 */
export function isFeMetadataInput(
  feJsonInput: FeJsonInput,
): feJsonInput is FeJsonInput & { settings: FeMetadataSettings } {
  const settings: unknown = feJsonInput.settings;
  return (
    typeof settings === 'object' &&
    settings !== null &&
    !Array.isArray(settings) &&
    'ingots' in settings
  );
}

// The alphabet Fe's metadata reader accepts for a namespace.
const FE_NAMESPACE_PATTERN = /^[\p{L}\p{N}_.-]+$/u;

/**
 * Check the shape of a Fe metadata input before `fe build --from-metadata`
 * reads it. Fe checks the input again when it rebuilds the project. This
 * check gives an early, clear error and keeps every source key inside the
 * rebuilt project: root ingot files must be `.fe` files under `src/` (or a
 * bare `<file>.fe` for a standalone file, which Fe writes to `src/`), and
 * dependency files `.fe` files under `<namespace>/src/`.
 */
export function validateFeMetadataInput(feJsonInput: FeJsonInput): void {
  if (!isFeMetadataInput(feJsonInput)) {
    throw new Error('Fe settings must be an object with an ingots array.');
  }
  const settings = feJsonInput.settings;
  const ingots: unknown = settings.ingots;
  if (!Array.isArray(ingots) || ingots.length === 0) {
    throw new Error('Fe settings.ingots must be a non-empty array.');
  }
  const namespaces = new Set<string>();
  let rootCount = 0;
  for (const ingot of ingots) {
    if (
      typeof ingot !== 'object' ||
      ingot === null ||
      typeof ingot.name !== 'string' ||
      typeof ingot.namespace !== 'string'
    ) {
      throw new Error(
        'Each Fe settings.ingots entry must have a string name and namespace.',
      );
    }
    if (ingot.namespace === '') {
      rootCount++;
      continue;
    }
    if (
      !FE_NAMESPACE_PATTERN.test(ingot.namespace) ||
      ingot.namespace === '.' ||
      ingot.namespace === '..' ||
      ingot.namespace === 'src'
    ) {
      throw new Error(`Invalid Fe ingot namespace: ${ingot.namespace}`);
    }
    if (namespaces.has(ingot.namespace)) {
      throw new Error(`Duplicate Fe ingot namespace: ${ingot.namespace}`);
    }
    namespaces.add(ingot.namespace);
  }
  if (rootCount !== 1) {
    throw new Error(
      `Fe settings.ingots must have exactly one root entry (empty namespace), found ${rootCount}.`,
    );
  }

  const sources = feJsonInput.sources ?? {};
  const keys = Object.keys(sources);
  if (keys.length === 0) {
    throw new Error('Fe sources must not be empty.');
  }
  for (const key of keys) {
    const segments = key.split('/');
    const rel =
      segments.length > 1 && namespaces.has(segments[0])
        ? segments.slice(1)
        : segments;
    const standaloneFile = segments.length === 1;
    if (
      key.includes('\0') ||
      key.includes('\\') ||
      (!standaloneFile && (rel.length < 2 || rel[0] !== 'src')) ||
      rel.some((s) => s === '' || s === '.' || s === '..') ||
      !key.endsWith('.fe')
    ) {
      throw new Error(
        `Fe source path must be a .fe file under src/ or <namespace>/src/: ${key}`,
      );
    }
    // Fe writes a bare key to src/<key>, so it must not shadow a src/ key.
    if (standaloneFile && `src/${key}` in sources) {
      throw new Error(`Fe sources ${key} and src/${key} name the same file.`);
    }
  }

  if (settings.compilationTarget !== undefined) {
    const target: unknown = settings.compilationTarget;
    if (
      typeof target !== 'object' ||
      target === null ||
      Array.isArray(target) ||
      Object.keys(target).length !== 1 ||
      typeof Object.values(target)[0] !== 'string'
    ) {
      throw new Error(
        'Fe settings.compilationTarget must have exactly one source path and contract name.',
      );
    }
    const targetPath = Object.keys(target)[0];
    if (!(targetPath in sources)) {
      throw new Error(
        `Fe settings.compilationTarget names a file that is not in sources: ${targetPath}`,
      );
    }
  }
}

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

  const fromMetadata = isFeMetadataInput(feJsonInput);
  if (fromMetadata) {
    if (semver.lt(version, MINIMUM_FE_METADATA_VERSION)) {
      throw new Error(
        `Fe metadata input needs Fe ${MINIMUM_FE_METADATA_VERSION} or later, got ${version}.`,
      );
    }
    validateFeMetadataInput(feJsonInput);
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
    const outDir = path.join(tmpDir, 'out');
    let buildArgs: string[];
    if (fromMetadata) {
      // Fe rebuilds the recorded ingots (names, dependencies, optimizer level)
      // from this file in a temp project of its own.
      const metadataPath = path.join(tmpDir, 'metadata.json');
      const metadata = {
        version: 1,
        language: 'Fe',
        compiler: { version },
        sources: feJsonInput.sources,
        settings: feJsonInput.settings,
      };
      await fs.promises.writeFile(metadataPath, JSON.stringify(metadata));
      buildArgs = [
        'build',
        '--from-metadata',
        metadataPath,
        '--out-dir',
        outDir,
      ];
    } else {
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
      buildArgs = ['build', tmpDir];
    }

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
    if (fromMetadata) {
      // `--from-metadata` builds in a temp project. Keep it inside tmpDir,
      // so the cleanup below deletes it even when the timeout kills fe.
      const feTmp = path.join(tmpDir, '.tmp');
      await fs.promises.mkdir(feTmp);
      feEnv.TMPDIR = feTmp;
      feEnv.TMP = feTmp;
      feEnv.TEMP = feTmp;
    }

    // Run fe build
    const startCompilation = Date.now();
    // spawnSync blocks this thread until fe exits, so a timer could never fire
    // here: its own timeout option is the only way to bound a hung compile and
    // free the verification worker slot (#2880).
    const spawned = spawnSync(fePath, buildArgs, {
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
    const outFiles = await fs.promises.readdir(outDir);

    const contracts: FeOutput['contracts'] = {};

    // Group by contract name (.bin and .runtime.bin)
    const contractNames = new Set<string>();
    for (const file of outFiles) {
      if (file.endsWith('.bin') && !file.endsWith('.runtime.bin')) {
        contractNames.add(file.slice(0, -4)); // strip .bin
      }
    }

    // fe builds only the contracts of the root ingot. Its files are under
    // src/, or a bare `<file>.fe` for a standalone file. Dependency files
    // (`<namespace>/src/...`) may reuse the contract names.
    const rootSourcePaths = Object.keys(feJsonInput.sources).filter(
      (sourcePath) =>
        sourcePath.startsWith('src/') || !sourcePath.includes('/'),
    );

    // Build contractName → sourcePath map by scanning source files for "pub contract Name"
    const contractToSourcePath: Record<string, string> = {};
    for (const sourcePath of rootSourcePaths) {
      const source = feJsonInput.sources[sourcePath];
      const matches = source.content.matchAll(/pub\s+contract\s+(\w+)/g);
      for (const match of matches) {
        contractToSourcePath[match[1]] = sourcePath;
      }
    }

    // With a compilationTarget, `fe build --from-metadata` builds only that
    // contract. Its artifact name can differ from the contract name (e.g.
    // `lib__Vault` when two files declare `Vault`), so key it by the target.
    const recordedTarget = fromMetadata
      ? (feJsonInput.settings as FeMetadataSettings).compilationTarget
      : undefined;

    for (const artifactName of contractNames) {
      const binPath = path.join(outDir, `${artifactName}.bin`);
      const runtimeBinPath = path.join(outDir, `${artifactName}.runtime.bin`);

      const creationBytecode = (
        await fs.promises.readFile(binPath, 'utf8')
      ).trim();
      const runtimeBytecode = (
        await fs.promises.readFile(runtimeBinPath, 'utf8')
      ).trim();

      let sourcePath: string;
      let contractName: string;
      if (recordedTarget && contractNames.size === 1) {
        [sourcePath, contractName] = Object.entries(recordedTarget)[0];
      } else {
        // Map back to the source path using regex scan; fallback to first root source
        contractName = artifactName;
        sourcePath =
          contractToSourcePath[artifactName] ??
          rootSourcePaths[0] ??
          Object.keys(feJsonInput.sources)[0];
      }
      // Fe writes no ABI file for a contract without ABI entries.
      const abiPath = path.join(outDir, `${artifactName}.abi.json`);
      const abi: JsonFragment[] = fs.existsSync(abiPath)
        ? JSON.parse((await fs.promises.readFile(abiPath, 'utf8')).trim())
        : [];

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
