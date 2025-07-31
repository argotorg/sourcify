// Configuration for replace-creation-information use case
// This configuration targets contracts where creation_code_hash equals runtime_code_hash
// and updates their creation information

module.exports = {
  query: async (sourcePool, sourcifySchema, currentVerifiedContract, n) => {
    return await sourcePool.query(
      `
      SELECT 
          cd.chain_id,
          cd.address,
          cd.transaction_hash,
          c.creation_code_hash,
          c.runtime_code_hash,
          vc.runtime_match,
          vc.creation_match,
          sm.runtime_match as sourcify_runtime_match,
          sm.creation_match as sourcify_creation_match,
          cd.created_at,
          vc.id as verified_contract_id
      FROM ${sourcifySchema}.contract_deployments cd
      JOIN ${sourcifySchema}.contracts c ON cd.contract_id = c.id
      JOIN ${sourcifySchema}.verified_contracts vc ON vc.deployment_id = cd.id
      LEFT JOIN ${sourcifySchema}.sourcify_matches sm ON sm.verified_contract_id = vc.id
      WHERE c.creation_code_hash = c.runtime_code_hash
          AND c.creation_code_hash IS NOT NULL
          AND c.runtime_code_hash IS NOT NULL
          AND vc.id >= $1
      ORDER BY vc.id ASC
      LIMIT $2
    `,
      [currentVerifiedContract, n],
    );
  },
  buildRequestBody: (contract) => {
    return {
      chainId: contract.chain_id.toString(),
      address: `0x${contract.address.toString("hex")}`,
      forceCompilation: false,
      forceRPCRequest: true,
      customReplaceMethod: "replace-creation-information",
    };
  },
  description:
    "Updates existing verified contracts with creation bytecode information for contracts where creation and runtime bytecode are identical",
};
