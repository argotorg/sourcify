// Configuration for replace-creation-information use case
// This configuration targets contracts where creation_code_hash equals runtime_code_hash
// and updates their creation information
// Issue: https://github.com/ethereum/sourcify/issues/1990

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
          sm.id as verified_contract_id
      FROM ${sourcifySchema}.contract_deployments cd
      JOIN ${sourcifySchema}.contracts c ON cd.contract_id = c.id
      JOIN ${sourcifySchema}.verified_contracts vc ON vc.deployment_id = cd.id
      INNER JOIN ${sourcifySchema}.sourcify_matches sm ON sm.verified_contract_id = vc.id
      WHERE c.creation_code_hash = c.runtime_code_hash
          AND c.creation_code_hash IS NOT NULL
          AND c.runtime_code_hash IS NOT NULL
          -- Exclude unsupported chains
          AND cd.chain_id NOT IN (3,4,5,28,43,50,69,77,99,300,420,534,570,592,842,1291,1433,1516,2017,2358,7701,9977,10242,10243,11111,12898,13381,16350,17069,26100,28528,32770,33101,33103,48899,57000,71401,78430,78431,78432,80001,84531,103090,167005,167006,202401,420420,420666,421611,421613,1127469,192837465,222000222,333000333,356256156,486217935,4216137055,7078815900)
          -- -- Exclude failing RPC chains
          AND cd.chain_id NOT IN (40,10200)
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
      transactionHash: `0x${contract.transaction_hash.toString("hex")}`,
      forceCompilation: false,
      forceRPCRequest: true,
      customReplaceMethod: "replace-creation-information",
    };
  },
  description:
    "Updates existing verified contracts with creation bytecode information for contracts where creation and runtime bytecode are identical",
};
