import semver from "semver";
import type {
  StorageLayout,
  VerificationExport,
} from "@ethereum-sourcify/lib-sourcify";
import {
  bytesFromString,
  prepareCompilerSettingsFromVerification,
} from "../../../../services/utils/database-util";
import type { SourcifyDatabaseService } from "../../../../services/storageServices/SourcifyDatabaseService";
import { BadRequestError } from "../../../../../common/errors";
import logger from "../../../../../common/logger";
import type { CustomReplaceMethod } from "./customReplaceMethods";

// 0.4.7 is the first release whose bytecode metadata binds the source. Older
// compilations with different layouts can otherwise deduplicate to one shared
// compiled_contracts row because that table is keyed by bytecode hashes.
const MINIMUM_VERSION = "0.4.7";
const NATIVE_STORAGE_LAYOUT_VERSION = "0.5.13";

/** Backfills only a missing historical Solidity storageLayout artifact. */
export const replaceSolidityStorageLayout: CustomReplaceMethod = async (
  sourcifyDatabaseService,
  verification,
) => {
  if (verification.compilation.language !== "Solidity") {
    throw new BadRequestError(
      `replace-solidity-storage-layout only supports Solidity contracts, got ${verification.compilation.language}`,
    );
  }

  const normalizedVersion = semver.valid(
    verification.compilation.compilerVersion.trim().replace(/^v/, ""),
  );
  if (
    !normalizedVersion ||
    semver.lt(normalizedVersion, MINIMUM_VERSION) ||
    !semver.lt(normalizedVersion, NATIVE_STORAGE_LAYOUT_VERSION)
  ) {
    throw new BadRequestError(
      "replace-solidity-storage-layout only supports Solidity versions from 0.4.7 through 0.5.12",
    );
  }

  const { runtimeMatch, creationMatch } = verification.status;
  if (
    ![runtimeMatch, creationMatch].some(
      (match) => match === "perfect" || match === "partial",
    )
  ) {
    throw new BadRequestError(
      "Cannot backfill a Solidity storage layout from a compilation that did not match the deployment",
    );
  }

  const storageLayout =
    verification.compilation.contractCompilerOutput.storageLayout;
  if (storageLayout === undefined) {
    const reason = "Historical Solidity storage layout could not be recovered";
    logger.info(reason, {
      chainId: verification.chainId,
      address: verification.address,
      compilerVersion: verification.compilation.compilerVersion,
    });
    return { reason, replaced: false };
  }
  if (!isSolidityStorageLayout(storageLayout)) {
    throw new BadRequestError(
      "Recovered Solidity storage layout has an invalid structure",
    );
  }

  const compilationId = await getSingleCompilationId(
    sourcifyDatabaseService,
    verification,
  );
  await writeMissingStorageLayout(
    sourcifyDatabaseService,
    verification,
    compilationId,
    storageLayout,
  );
};

function isSolidityStorageLayout(value: unknown): value is StorageLayout {
  if (typeof value !== "object" || value === null) return false;
  const layout = value as Partial<StorageLayout>;
  return (
    Array.isArray(layout.storage) &&
    (layout.types === null ||
      (typeof layout.types === "object" && !Array.isArray(layout.types)))
  );
}

async function getSingleCompilationId(
  sourcifyDatabaseService: SourcifyDatabaseService,
  verification: VerificationExport,
): Promise<string> {
  const result = await sourcifyDatabaseService.database.pool.query(
    `SELECT vc.compilation_id
       FROM verified_contracts vc
       JOIN contract_deployments cd ON cd.id = vc.deployment_id
       INNER JOIN sourcify_matches sm ON sm.verified_contract_id = vc.id
       WHERE cd.chain_id = $1 AND cd.address = $2`,
    [verification.chainId.toString(), bytesFromString(verification.address)],
  );
  if (result.rows.length === 0) {
    throw new Error(
      `No existing verified contract found for address ${verification.address} on chain ${verification.chainId}`,
    );
  }
  if (result.rows.length > 1) {
    throw new Error(
      `Multiple verified contracts found for address ${verification.address} on chain ${verification.chainId}; cannot safely backfill storageLayout`,
    );
  }
  return result.rows[0].compilation_id;
}

async function writeMissingStorageLayout(
  sourcifyDatabaseService: SourcifyDatabaseService,
  verification: VerificationExport,
  compilationId: string,
  storageLayout: StorageLayout,
) {
  const { path, name } = verification.compilation.compilationTarget;
  const settings = prepareCompilerSettingsFromVerification(verification);
  const additionalInput = verification.compilation.additionalInput ?? null;
  const result = await sourcifyDatabaseService.database.pool.query(
    `UPDATE compiled_contracts cc
       SET compilation_artifacts = jsonb_set(
         COALESCE(cc.compilation_artifacts, '{}'::jsonb),
         '{storageLayout}', $7::jsonb, true)
       WHERE cc.id = $1
         AND cc.language = 'solidity'
         AND cc.version = $2
         AND cc.fully_qualified_name = $3
         AND cc.compiler_settings = $4::jsonb
         AND cc.additional_input IS NOT DISTINCT FROM $5::jsonb
         AND (
           SELECT jsonb_object_agg(ccs.path, sources.content)
           FROM compiled_contracts_sources ccs
           JOIN sources ON sources.source_hash = ccs.source_hash
           WHERE ccs.compilation_id = cc.id
         ) = $6::jsonb
         AND (
           cc.compilation_artifacts->'storageLayout' IS NULL
           OR cc.compilation_artifacts->'storageLayout' = 'null'::jsonb
         )
       RETURNING cc.id`,
    [
      compilationId,
      verification.compilation.compilerVersion,
      `${path}:${name}`,
      JSON.stringify(settings),
      additionalInput === null ? null : JSON.stringify(additionalInput),
      JSON.stringify(verification.compilation.sources),
      JSON.stringify(storageLayout),
    ],
  );
  if (result.rows.length !== 1) {
    throw new BadRequestError(
      "Fresh Solidity compilation identity does not match the stored compilation, or storageLayout is already populated; refusing to replace storageLayout",
    );
  }
}
