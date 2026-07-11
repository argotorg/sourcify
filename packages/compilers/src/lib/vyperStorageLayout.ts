import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import semver from 'semver';
import type {
  VyperJsonInput,
  VyperStorageLayout,
} from '@ethereum-sourcify/compilers-types';

const FIRST_SUPPORTED_VYPER_LAYOUT = '0.1.0-beta.16';
const FIRST_STANDARD_JSON_VYPER_LAYOUT = '0.4.1-beta.4';
const MAX_LAYOUT_OUTPUT_SIZE = 16 * 1024 * 1024;
const DEFAULT_VYPER_PROCESS_TIMEOUT = 5 * 60 * 1000;
const VYPER_STORAGE_LAYOUT_WORKER_PATH = path.join(
  __dirname,
  'vyperStorageLayoutWorker.py',
);

interface VyperStorageLayoutWorkerOutput {
  schema?: string;
  compiler_version?: string;
  layout?: unknown;
  type_definitions?: unknown;
  leaf_type_definitions?: unknown;
  method?: string;
  error?: string;
}

interface LayoutLeaf {
  name: string;
  type: string;
  slot: number;
  nSlots: number;
}

interface VyperStorageTypeDefinition {
  members: Array<{ name: string; type: string; slot: number; n_slots: number }>;
  n_slots: number;
}

export function normalizeVyperVersionForPython(version: string): string {
  const normalized = version
    .replace(/^v/, '')
    .split('+')[0]
    .replace(/-beta\.(\d+)$/, 'b$1')
    .replace(/-alpha\.(\d+)$/, 'a$1')
    .replace(/-rc\.(\d+)$/, 'rc$1');
  // Vyper 0.2.0 was published to GitHub but not PyPI. Vyper's 0.2.1
  // release notes identify it as code-identical to 0.2.0.
  return normalized === '0.2.0' ? '0.2.1' : normalized;
}

function normalizeVyperVersionForSemver(version: string): string {
  return version
    .replace(/^v/, '')
    .split('+')[0]
    .replace(/(\d+\.\d+\.\d+)b(\d+)$/, '$1-beta.$2')
    .replace(/(\d+\.\d+\.\d+)a(\d+)$/, '$1-alpha.$2')
    .replace(/(\d+\.\d+\.\d+)rc(\d+)$/, '$1-rc.$2');
}

export function supportsHistoricalVyperStorageLayout(version: string): boolean {
  const normalized = normalizeVyperVersionForSemver(version);
  if (!semver.valid(normalized)) return false;
  return (
    semver.gte(normalized, FIRST_SUPPORTED_VYPER_LAYOUT) &&
    semver.lt(normalized, FIRST_STANDARD_JSON_VYPER_LAYOUT)
  );
}

export function pythonVersionForVyper(version: string): string {
  const normalized = normalizeVyperVersionForSemver(version);
  if (semver.lt(normalized, '0.3.0')) return '3.8';
  if (semver.lt(normalized, '0.3.2')) return '3.9';
  if (semver.lt(normalized, '0.5.0-0')) return '3.10';
  return '3.11';
}

function executeWithInput(
  executable: string,
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv,
  maxOutputSize: number,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // On Unix, make uv and the compiler descendants one process group so a
      // timeout or output limit can terminate the entire tree.
      detached: process.platform !== 'win32',
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let settled = false;
    let pendingFailure: Error | undefined;
    let forceKill: NodeJS.Timeout | undefined;

    const killProcessTree = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid !== undefined) {
          process.kill(-child.pid, signal);
        } else {
          child.kill(signal);
        }
      } catch (error: any) {
        if (error?.code !== 'ESRCH') throw error;
      }
    };

    const stopProcess = (error: Error) => {
      if (settled || pendingFailure) return;
      pendingFailure = error;

      // Stop retaining output immediately. Destroying the pipes also prevents
      // an uncooperative descendant from continuing to fill Node buffers.
      child.stdout.removeAllListeners('data');
      child.stderr.removeAllListeners('data');
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdin.destroy();
      stdout.length = 0;
      stderr.length = 0;

      try {
        killProcessTree('SIGTERM');
      } catch {
        // The close/error handlers below remain authoritative.
      }
      forceKill = setTimeout(() => {
        try {
          killProcessTree('SIGKILL');
        } catch {
          // The process may already have exited between the timers.
        }
      }, 1000);
      forceKill.unref();
    };

    const timeout = setTimeout(
      () =>
        stopProcess(
          new Error(`Vyper compiler process timed out after ${timeoutMs}ms`),
        ),
      timeoutMs,
    );

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      reject(error);
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > maxOutputSize) {
        stopProcess(new Error('Vyper compiler output size too large'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrSize += chunk.length;
      if (stderrSize > maxOutputSize) {
        stopProcess(new Error('Vyper compiler error output size too large'));
        return;
      }
      stderr.push(chunk);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      if (pendingFailure) {
        reject(pendingFailure);
        return;
      }
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        const output = Buffer.concat(stdout).toString('utf8').trim();
        let workerError = '';
        try {
          workerError = JSON.parse(output)?.error || '';
        } catch {
          // The process did not emit JSON. Prefer its stderr below.
        }
        reject(
          new Error(
            `Vyper storage layout worker exited with status ${code}: ${workerError || detail || 'unknown error'}`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8'));
    });

    child.stdin.on('error', (error) => stopProcess(error));
    child.stdin.end(input);
  });
}

function vyperProcessTimeout(): number {
  const configured = Number(process.env.VYPER_PROCESS_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_VYPER_PROCESS_TIMEOUT;
}

export async function runIsolatedVyper(
  vyperRepoPath: string,
  version: string,
  command: string[],
  input: string,
  maxOutputSize: number,
): Promise<string> {
  const cacheRoot = path.join(vyperRepoPath, 'python-cache');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const uv =
    process.env.VYPER_UV_PATH || process.env.VYPER_LAYOUT_UV_PATH || 'uv';
  const args = [
    'run',
    '--isolated',
    '--no-project',
    '--python',
    pythonVersionForVyper(version),
    '--with',
    `vyper==${normalizeVyperVersionForPython(version)}`,
    '--with',
    'setuptools<81',
    ...command,
  ];
  return executeWithInput(
    uv,
    args,
    input,
    {
      ...process.env,
      UV_CACHE_DIR: path.join(cacheRoot, 'uv'),
      UV_PYTHON_INSTALL_DIR: path.join(cacheRoot, 'python'),
      UV_NO_PROGRESS: '1',
    },
    maxOutputSize,
    vyperProcessTimeout(),
  );
}

function repairOuterDuplicatedVyperHashMapType(type: string): string {
  if (!type.startsWith('HashMap[')) return type;
  let depth = 0;
  let close = -1;
  for (let index = 0; index < type.length; index += 1) {
    if (type[index] === '[') depth += 1;
    if (type[index] === ']') {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0 || close === type.length - 1) return type;
  const suffix = type.slice(close + 1);
  const generic = type.slice('HashMap'.length, close + 1);
  return suffix === generic ? type.slice(0, close + 1) : type;
}

function splitTopLevelTypes(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '[') depth += 1;
    if (value[index] === ']') depth -= 1;
    if (value[index] === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

export function repairDuplicatedVyperHashMapType(type: string): string {
  const repaired = repairOuterDuplicatedVyperHashMapType(type);
  if (!repaired.startsWith('HashMap[') || !repaired.endsWith(']')) {
    return repaired;
  }
  const parts = splitTopLevelTypes(
    repaired.slice('HashMap['.length, repaired.length - 1),
  );
  if (parts.length !== 2) return repaired;
  return `HashMap[${repairDuplicatedVyperHashMapType(
    parts[0],
  )}, ${repairDuplicatedVyperHashMapType(parts[1])}]`;
}

function parsePositiveInteger(value: unknown, field: string): number {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)) {
    parsed = parseInt(value, 16);
  } else if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) {
    parsed = Number(value);
  } else {
    throw new Error(`Invalid Vyper storage layout ${field}: ${String(value)}`);
  }
  if (!Number.isSafeInteger(parsed) || parsed < (field === 'slot' ? 0 : 1)) {
    throw new Error(`Invalid Vyper storage layout ${field}: ${String(value)}`);
  }
  return parsed;
}

function normalizeTypeDefinitions(
  value: unknown,
): Record<string, VyperStorageTypeDefinition> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Vyper storage layout type definitions');
  }

  const definitions: Record<string, VyperStorageTypeDefinition> = {};
  for (const [label, rawDefinition] of Object.entries(value)) {
    if (
      !label ||
      !rawDefinition ||
      typeof rawDefinition !== 'object' ||
      Array.isArray(rawDefinition)
    ) {
      throw new Error(`Invalid Vyper storage type definition: ${label}`);
    }
    const definition = rawDefinition as Record<string, unknown>;
    if (!Array.isArray(definition.members)) {
      throw new Error(
        `Invalid Vyper storage type definition members: ${label}`,
      );
    }
    const members = definition.members.map((rawMember) => {
      if (
        !rawMember ||
        typeof rawMember !== 'object' ||
        Array.isArray(rawMember)
      ) {
        throw new Error(
          `Invalid Vyper storage type definition member: ${label}`,
        );
      }
      const member = rawMember as Record<string, unknown>;
      if (
        typeof member.name !== 'string' ||
        !member.name ||
        typeof member.type !== 'string' ||
        !member.type
      ) {
        throw new Error(
          `Invalid Vyper storage type definition member: ${label}`,
        );
      }
      return {
        name: member.name,
        type: repairDuplicatedVyperHashMapType(member.type),
        slot: parsePositiveInteger(member.slot, 'slot'),
        n_slots: parsePositiveInteger(member.n_slots, 'n_slots'),
      };
    });
    definitions[label] = {
      members,
      n_slots: parsePositiveInteger(definition.n_slots, 'n_slots'),
    };
  }
  return Object.keys(definitions).length > 0 ? definitions : undefined;
}

function typeDefinitionsForLeaf(
  type: string,
  definitions: Record<string, VyperStorageTypeDefinition> | undefined,
): Record<string, VyperStorageTypeDefinition> | undefined {
  if (!definitions) return undefined;

  const selected: Record<string, VyperStorageTypeDefinition> = {};
  const pending: string[] = [
    ...(type.match(/[A-Za-z_$][A-Za-z0-9_.$]*/g) || []),
  ];
  while (pending.length > 0) {
    const label = pending.pop()!;
    const definition = definitions[label];
    if (!definition || selected[label]) continue;
    selected[label] = definition;
    for (const member of definition.members) {
      pending.push(...(member.type.match(/[A-Za-z_$][A-Za-z0-9_.$]*/g) || []));
    }
  }
  return Object.keys(selected).length > 0 ? selected : undefined;
}

function normalizeLeafTypeDefinitions(
  value: unknown,
): Record<string, Record<string, VyperStorageTypeDefinition>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Vyper storage layout leaf type definitions');
  }
  const result: Record<string, Record<string, VyperStorageTypeDefinition>> = {};
  for (const [leaf, rawDefinitions] of Object.entries(value)) {
    const definitions = normalizeTypeDefinitions(rawDefinitions);
    if (definitions) result[leaf] = definitions;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function flattenLayout(
  value: Record<string, unknown>,
  prefix: string[] = [],
): LayoutLeaf[] {
  const leaves: LayoutLeaf[] = [];
  for (const [name, rawItem] of Object.entries(value)) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      throw new Error(`Invalid Vyper storage layout entry: ${name}`);
    }
    const item = rawItem as Record<string, unknown>;
    const isLeaf =
      ('slot' in item &&
        (item.slot === null || typeof item.slot !== 'object')) ||
      ('type' in item && (item.type === null || typeof item.type !== 'object'));
    if (isLeaf) {
      if (typeof item.type !== 'string' || !('slot' in item)) {
        throw new Error(`Incomplete Vyper storage layout entry: ${name}`);
      }
      leaves.push({
        name: [...prefix, name].join('.'),
        type: repairDuplicatedVyperHashMapType(item.type),
        slot: parsePositiveInteger(item.slot, 'slot'),
        nSlots: parsePositiveInteger(item.n_slots, 'n_slots'),
      });
    } else {
      leaves.push(...flattenLayout(item, [...prefix, name]));
    }
  }
  return leaves;
}

export function normalizeVyperStorageLayout(
  rawLayout: unknown,
  rawTypeDefinitions?: unknown,
  rawLeafTypeDefinitions?: unknown,
): VyperStorageLayout {
  if (!rawLayout || typeof rawLayout !== 'object' || Array.isArray(rawLayout)) {
    throw new Error('Vyper storage layout worker returned an invalid layout');
  }
  const raw = rawLayout as Record<string, unknown>;
  const storageLayout = raw.storage_layout;
  const storageLayoutIsWrapper =
    storageLayout &&
    typeof storageLayout === 'object' &&
    !Array.isArray(storageLayout) &&
    !(
      ('slot' in storageLayout &&
        (storageLayout.slot === null ||
          typeof storageLayout.slot !== 'object')) ||
      ('type' in storageLayout &&
        (storageLayout.type === null || typeof storageLayout.type !== 'object'))
    );
  const persistent = storageLayoutIsWrapper
    ? (storageLayout as Record<string, unknown>)
    : raw;
  const leaves = flattenLayout(persistent).sort(
    (left, right) =>
      left.slot - right.slot || left.name.localeCompare(right.name),
  );
  const typeDefinitions = normalizeTypeDefinitions(rawTypeDefinitions);
  const leafTypeDefinitions = normalizeLeafTypeDefinitions(
    rawLeafTypeDefinitions,
  );
  return Object.fromEntries(
    leaves.map(({ name, type, slot, nSlots }) => {
      const reachableDefinitions = typeDefinitionsForLeaf(
        type,
        leafTypeDefinitions?.[name] || typeDefinitions,
      );
      return [
        name,
        {
          type,
          slot,
          n_slots: nSlots,
          ...(reachableDefinitions
            ? { type_definitions: reachableDefinitions }
            : {}),
        },
      ];
    }),
  );
}

/**
 * Recover storage layout with the exact historical Vyper package.
 *
 * Vyper 0.2.16-0.4.1b3 computes a native layout but drops it while formatting
 * Standard JSON. Vyper 0.1.0b16-0.2.15 requires compiler-internal allocation
 * data. The isolated worker handles both without loading Python compiler state
 * into the Node process.
 */
export async function useVyperStorageLayout(
  vyperRepoPath: string,
  version: string,
  vyperJsonInput: VyperJsonInput,
  targetPath: string,
): Promise<VyperStorageLayout> {
  if (!supportsHistoricalVyperStorageLayout(version)) {
    throw new Error(
      `Historical Vyper storage layout extraction does not support ${version}`,
    );
  }
  if (vyperJsonInput.sources[targetPath]?.content === undefined) {
    throw new Error(`Vyper storage layout target not found: ${targetPath}`);
  }

  const command = ['python', VYPER_STORAGE_LAYOUT_WORKER_PATH];
  const payload = JSON.stringify({
    target: targetPath,
    sources: vyperJsonInput.sources,
    interfaces: vyperJsonInput.interfaces || {},
    json_input: vyperJsonInput,
  });
  const output = await runIsolatedVyper(
    vyperRepoPath,
    version,
    command,
    payload,
    MAX_LAYOUT_OUTPUT_SIZE,
  );

  let parsed: VyperStorageLayoutWorkerOutput;
  try {
    parsed = JSON.parse(output) as VyperStorageLayoutWorkerOutput;
  } catch {
    throw new Error('Vyper storage layout worker returned invalid JSON');
  }
  if (parsed.error) {
    throw new Error(`Vyper storage layout extraction failed: ${parsed.error}`);
  }
  if (parsed.schema !== 'sourcify/vyper-storage-layout/v1') {
    throw new Error('Vyper storage layout worker returned an unknown schema');
  }
  return normalizeVyperStorageLayout(
    parsed.layout,
    parsed.type_definitions,
    parsed.leaf_type_definitions,
  );
}
