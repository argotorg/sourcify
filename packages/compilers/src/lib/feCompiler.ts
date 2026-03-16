import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawnSync } from 'child_process';
import { CompilerError, fetchWithBackoff } from './common';
import { logDebug, logError, logInfo, logWarn } from '../logger';
import type { FeJsonInput, FeOutput } from '@ethereum-sourcify/compilers-types';

const HOST_FE_REPO =
  'https://github.com/argotorg/fe/releases/download/';

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
  const fePath = path.join(feRepoPath, fileName);
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
 */
export async function useFeCompiler(
  feRepoPath: string,
  version: string,
  feJsonInput: FeJsonInput,
): Promise<FeOutput> {
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
    // Scaffold ingot structure
    const feToml = `[ingot]\nname = "sourcify_verification"\nversion = "0.1.0"\n`;
    await fs.promises.writeFile(path.join(tmpDir, 'fe.toml'), feToml);

    const srcDir = path.join(tmpDir, 'src');
    await fs.promises.mkdir(srcDir, { recursive: true });

    // Write source files
    for (const [sourcePath, source] of Object.entries(feJsonInput.sources)) {
      const fullPath = path.join(srcDir, sourcePath);
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, source.content);
    }

    // Run fe build
    const startCompilation = Date.now();
    const spawned = spawnSync(fePath, ['build', tmpDir], {
      cwd: tmpDir,
      maxBuffer: 250 * 1024 * 1024,
    });
    const endCompilation = Date.now();
    logInfo('Fe compilation done', { timeInMs: endCompilation - startCompilation });

    if (spawned.status !== 0) {
      const stderr = spawned.stderr?.toString() || '';
      const errorMessage = spawned.error?.message || stderr || 'Compilation failed';
      logError('Fe compiler error', { errorMessage });
      throw new CompilerError('Fe compiler error', [
        { severity: 'error', message: errorMessage, type: 'CompilerError', component: 'general', formattedMessage: errorMessage },
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

    for (const contractName of contractNames) {
      const binPath = path.join(outDir, `${contractName}.bin`);
      const runtimeBinPath = path.join(outDir, `${contractName}.runtime.bin`);

      const creationBytecode = (
        await fs.promises.readFile(binPath, 'utf8')
      ).trim();
      const runtimeBytecode = (
        await fs.promises.readFile(runtimeBinPath, 'utf8')
      ).trim();

      // Map back to the source path (use the first source file as the key)
      const sourcePath = Object.keys(feJsonInput.sources)[0];
      if (!contracts[sourcePath]) {
        contracts[sourcePath] = {};
      }
      contracts[sourcePath][contractName] = {
        abi: null,
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
