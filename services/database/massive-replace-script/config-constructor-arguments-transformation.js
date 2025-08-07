// Configuration for fixing missing constructorArguments transformation
// This configuration targets contracts where creation code exists but creation_match is null/false
// and the recompiled creation code matches the onchain creation code
// Related to: https://github.com/ethereum/sourcify/issues/2086

module.exports = {
  query: async (sourcePool, sourcifySchema, currentVerifiedContract, n) => {
    return await sourcePool.query(
      `
      SELECT 
          cd.chain_id,
          cd.address,
          sm.id as verified_contract_id
      FROM ${sourcifySchema}.verified_contracts vc
      JOIN ${sourcifySchema}.contract_deployments cd ON vc.deployment_id = cd.id
      JOIN ${sourcifySchema}.contracts c ON cd.contract_id = c.id
      JOIN ${sourcifySchema}.code creation_code ON c.creation_code_hash = creation_code.code_hash
      JOIN ${sourcifySchema}.compiled_contracts cc ON vc.compilation_id = cc.id
      JOIN ${sourcifySchema}.code recompiled_creation_code ON cc.creation_code_hash = recompiled_creation_code.code_hash
      INNER JOIN ${sourcifySchema}.sourcify_matches sm ON sm.verified_contract_id = vc.id
      WHERE c.creation_code_hash IS NOT NULL 
          AND position(substring(recompiled_creation_code.code for 200) in creation_code.code) != 0
          AND (vc.creation_match is null or vc.creation_match = false)
          AND sm.id >= $1
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
      forceCompilation: false,
      forceRPCRequest: false,
      customReplaceMethod: "replace-creation-information",
    };
  },
  description:
    "Fixes missing constructorArguments transformation for contracts where creation code exists but creation_match is null/false. See https://github.com/ethereum/sourcify/issues/2086",
};
