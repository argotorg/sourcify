// Configuration for replacing metadata in sourcify_matches table
// This configuration targets contracts with partial runtime matches where metadata needs to be updated
// because it does not match the sources in the database.
// Only processes contracts where source hashes don't match the existing metadata
// Issue: https://github.com/ethereum/sourcify/issues/2227

const { id: keccak256str } = require("ethers");

module.exports = {
  query: async (sourcePool, sourcifySchema, currentVerifiedContract, n) => {
    return await sourcePool.query(
      `
      SELECT 
          cd.chain_id,
          cd.address,
          sm.id as verified_contract_id,
          json_build_object(
            'language', INITCAP(cc.language), 
            'sources', json_object_agg(compiled_contracts_sources.path, json_build_object('content', sources.content)),
            'settings', cc.compiler_settings
          ) as std_json_input,
          cc.version as compiler_version,
          cc.fully_qualified_name,
          sm.metadata
      FROM ${sourcifySchema}.sourcify_matches sm
      JOIN ${sourcifySchema}.verified_contracts vc ON sm.verified_contract_id = vc.id
      JOIN ${sourcifySchema}.contract_deployments cd ON vc.deployment_id = cd.id
      JOIN ${sourcifySchema}.compiled_contracts cc ON vc.compilation_id = cc.id
      JOIN ${sourcifySchema}.compiled_contracts_sources ON compiled_contracts_sources.compilation_id = cc.id
      LEFT JOIN ${sourcifySchema}.sources ON sources.source_hash = compiled_contracts_sources.source_hash
      WHERE sm.created_at < '2024-08-29 08:58:57 +0200'
          AND sm.runtime_match ='partial'
          AND sm.id >= $1
      GROUP BY sm.id, vc.id, cc.id, cd.id
      ORDER BY sm.id ASC
      LIMIT $2
    `,
      [currentVerifiedContract, n],
    );
  },
  buildRequestBody: (contract) => {
    return {
      chainId: contract.chain_id.toString(),
      address: `0x${contract.address.toString("hex")}`,
      forceCompilation: true,
      jsonInput: contract.std_json_input,
      compilerVersion: contract.compiler_version,
      compilationTarget: contract.fully_qualified_name,
      forceRPCRequest: false,
      customReplaceMethod: "replace-metadata",
    };
  },
  excludeContract: (contract) => {
    const address = `0x${contract.address.toString("hex")}`;
    const sources = contract.std_json_input.sources;
    const currentMetadata = contract.metadata;

    if (!sources || !currentMetadata) {
      console.log(
        `Contract address=${address}, chain_id=${contract.chain_id}: Missing sources or metadata -> skipping`,
      );
      return true; // Exclude if no sources or metadata
    }

    if (
      Object.keys(sources).length !==
      Object.keys(currentMetadata.sources).length
    ) {
      console.log(
        `Contract address=${address}, chain_id=${contract.chain_id}: wrong sources length: ${Object.keys(sources).length} (std json) vs ${Object.keys(currentMetadata.sources).length} (metadata)`,
      );
      return false; // something is wrong -> replace metadata
    }

    for (const [sourcePath, sourceMetadata] of Object.entries(
      currentMetadata.sources,
    )) {
      const expectedHash = sourceMetadata.keccak256;

      if (!sources[sourcePath]) {
        console.log(
          `Contract address=${address}, chain_id=${contract.chain_id}: Metadata source ${sourcePath} not in sources`,
        );
        return false; // something is wrong -> replace metadata
      }

      const contentHash = keccak256str(sources[sourcePath].content);

      if (contentHash !== expectedHash) {
        console.log(
          `Contract address=${address}, chain_id=${contract.chain_id}: ContentHash does not match metadata hash for source ${sourcePath}: ${contentHash} (std json) vs ${expectedHash} (metadata)`,
        );
        return false; // something is wrong -> replace metadata
      }
    }

    return true; // All sources match the metadata, exclude this contract
  },
  description:
    "Replaces metadata in sourcify_matches table for contracts where source content hashes don't match the existing metadata hashes.",
};
