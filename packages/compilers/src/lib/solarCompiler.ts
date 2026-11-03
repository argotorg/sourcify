import path from 'path';
import fs from 'fs';
import { gunzipSync } from 'zlib';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { threadId } from 'worker_threads';
import { asyncExec, CompilerError, fetchWithBackoff } from './common';
import { logDebug, logError, logInfo, logWarn } from '../logger';
import { parseSolarVersion } from '@ethereum-sourcify/compilers-types';
import type {
  SolarJsonInput,
  SolarOutput,
  SolarVersion,
} from '@ethereum-sourcify/compilers-types';

const HOST_SOLAR_REPO =
  'https://github.com/paradigmxyz/solar/releases/download/';
// Copies of builds that are not a release, e.g. the Solar that Foundry bundles
const HOST_SOLAR_DEV_BUILDS =
  'https://storage.googleapis.com/solar-dev-binary/solar/';

/**
 * Returns the target of the Solar release archive for this machine.
 * Linux x64 uses the static musl build, which runs on any glibc.
 */
export function findSolarPlatform(): string | false {
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return 'x86_64-unknown-linux-musl';
    if (process.arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return 'x86_64-apple-darwin';
    if (process.arch === 'arm64') return 'aarch64-apple-darwin';
  }
  return false;
}

/**
 * Compiles with Solar in standard JSON mode.
 *
 * @param solarRepoPath folder that caches the Solar binaries
 * @param version the solc-compatible Solar version, e.g. 0.8.38+commit.e7a91fc7.solar.0.3.0
 * @param solarJsonInput standard JSON input, the solc format plus Solar settings
 * @param timeoutMs wall-clock limit for the subprocess, defaults to DEFAULT_COMPILE_TIMEOUT_MS
 */
export async function useSolarCompiler(
  solarRepoPath: string,
  version: string,
  solarJsonInput: SolarJsonInput,
  timeoutMs?: number,
): Promise<SolarOutput> {
  const solarVersion = parseSolarVersion(version);
  if (!solarVersion) {
    throw new Error(`Invalid Solar version: ${version}`);
  }
  const solarPlatform = findSolarPlatform();
  if (!solarPlatform) {
    throw new Error('Solar is not supported on this machine.');
  }

  const solarPath = await getSolarExecutable(
    solarRepoPath,
    solarPlatform,
    solarVersion,
  );

  // Absolute path: asyncExec runs in a temp cwd (#2920), breaking relative paths.
  const absoluteSolarPath = path.resolve(solarPath);
  const startCompilation = Date.now();
  let compiled: string;
  try {
    compiled = await asyncExec(
      `${absoluteSolarPath} --standard-json`,
      JSON.stringify(solarJsonInput),
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
    compiler: 'solar',
    timeInMs: Date.now() - startCompilation,
  });

  if (!compiled) {
    throw new Error('Compilation failed. No output from the compiler.');
  }
  const compiledJSON = JSON.parse(compiled) as SolarOutput;
  const errorMessages = compiledJSON?.errors?.filter(
    (e) => e.severity === 'error',
  );
  if (errorMessages && errorMessages.length > 0) {
    logError('Compiler error', { errorMessages });
    throw new CompilerError('Compiler error', errorMessages);
  }
  return compiledJSON;
}

/**
 * Returns the path of the Solar binary for the given version.
 * Uses a cached binary when one exists, otherwise downloads the release.
 * A build that is not a release (e.g. 0.3.0-dev) comes from Sourcify's copies.
 */
export async function getSolarExecutable(
  solarRepoPath: string,
  platform: string,
  version: SolarVersion,
): Promise<string> {
  const fileName = `solar-${platform}-v${version.solarVersion}+commit.${version.commit}`;
  const solarPath = path.join(solarRepoPath, fileName);
  const isRelease = !version.solarVersion.includes('-');
  if (fs.existsSync(solarPath)) {
    try {
      assertSolarBuild(solarPath, version);
      logDebug('Found existing Solar binary', { solarPath });
      return solarPath;
    } catch (error: any) {
      // Replace a wrong or broken cached binary, as the solc and vyper paths do
      logWarn(
        'Cached Solar binary is not the requested build, downloading again',
        {
          solarPath,
          error: error.message,
        },
      );
      fs.rmSync(solarPath, { force: true });
    }
  }

  // Unique temp name so parallel workers never run a half-written binary.
  // Piscina workers are threads of one process, so the pid alone is not unique.
  const tmpPath = `${solarPath}.${process.pid}.${threadId}.${randomUUID()}.tmp`;
  if (isRelease) {
    await fetchAndSaveSolar(platform, version.solarVersion, tmpPath);
  } else {
    await fetchAndSaveSolarCopy(fileName, version, tmpPath);
  }
  try {
    assertSolarBuild(tmpPath, version);
    fs.renameSync(tmpPath, solarPath);
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
  return solarPath;
}

/**
 * Throws unless the binary is the requested Solar build. The release tag
 * names only the version, so this check also rejects an unknown commit.
 */
function assertSolarBuild(solarPath: string, version: SolarVersion) {
  const spawned = spawnSync(solarPath, ['--version']);
  if (spawned.status !== 0) {
    const error =
      spawned?.error?.message ||
      spawned.stderr?.toString() ||
      'Error running Solar binary, are you on the right platform?';
    throw new Error(`Cannot run Solar binary ${solarPath}: ${error}`);
  }
  // The first line is e.g. `solar 0.3.0+commit.e7a91fc7`
  const firstLine = spawned.stdout.toString().split('\n')[0].trim();
  const expected = `solar ${version.solarVersion}+commit.${version.commit}`;
  if (firstLine !== expected) {
    throw new Error(
      `Solar build ${version.solarVersion}+commit.${version.commit} not found: the binary reports "${firstLine}"`,
    );
  }
}

// Fetches the copy that Sourcify hosts of a build that is not a release
async function fetchAndSaveSolarCopy(
  fileName: string,
  version: SolarVersion,
  solarPath: string,
): Promise<void> {
  const solarURI = `${HOST_SOLAR_DEV_BUILDS}${encodeURIComponent(fileName)}`;
  logInfo('Fetching Solar', { solarURI, solarPath });

  const res = await fetchWithBackoff(solarURI);
  if (res.status !== 200) {
    logError('Failed fetching Solar', { solarURI, status: res.status });
    throw new Error(
      `Solar ${version.solarVersion}+commit.${version.commit} is not a release, and Sourcify has no copy of it for this platform`,
    );
  }
  fs.mkdirSync(path.dirname(solarPath), { recursive: true });
  fs.writeFileSync(solarPath, Buffer.from(await res.arrayBuffer()), {
    mode: 0o755,
  });
  logInfo('Saved Solar', { solarURI, solarPath });
}

async function fetchAndSaveSolar(
  platform: string,
  solarVersion: string,
  solarPath: string,
): Promise<void> {
  const archiveName = `solar-${platform}`;
  const solarURI = `${HOST_SOLAR_REPO}v${solarVersion}/${archiveName}.tar.gz`;
  logInfo('Fetching Solar', { solarVersion, platform, solarURI, solarPath });

  const res = await fetchWithBackoff(solarURI);
  if (res.status !== 200) {
    logError('Failed fetching Solar', { solarVersion, platform, solarURI });
    throw new Error(
      `Failed fetching Solar ${solarVersion} for platform ${platform}. Please check if the version is valid.`,
    );
  }
  const archive = Buffer.from(await res.arrayBuffer());
  const binary = extractFileFromTarGz(archive, `${archiveName}/solar`);
  if (!binary) {
    throw new Error(`Solar binary not found in ${solarURI}`);
  }
  fs.mkdirSync(path.dirname(solarPath), { recursive: true });
  fs.writeFileSync(solarPath, binary, { mode: 0o755 });
  logInfo('Saved Solar', { solarVersion, platform, solarPath });
}

/**
 * Returns the content of one regular file in a .tar.gz archive.
 * Supports the ustar format that the Solar release archives use.
 */
export function extractFileFromTarGz(
  archive: Buffer,
  filePath: string,
): Buffer | undefined {
  const tar = gunzipSync(archive);
  // Header fields are NUL-terminated
  const readString = (header: Buffer, start: number, length: number) => {
    const field = header.subarray(start, start + length);
    const end = field.indexOf(0);
    return field.subarray(0, end === -1 ? length : end).toString('utf8');
  };

  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    // Two empty blocks end the archive
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const size = parseInt(readString(header, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const dataStart = offset + 512;
    if ((type === '0' || type === '\0') && entryPath === filePath) {
      return Buffer.from(tar.subarray(dataStart, dataStart + size));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return undefined;
}
