// Configuration for replacing metadata in sourcify_matches table
// This configuration targets contracts with partial runtime matches where metadata needs to be updated
// because it does not match the sources in the database.
// Only processes contracts where source hashes don't match the existing metadata
// Issue: https://github.com/argotorg/sourcify/issues/2227

const { id: keccak256str } = require("ethers");

//ensure compilation outputs same pseudo pkey as before
// get all sources hashes for the compilation
// delete all entries in compiled_contracts_sources which reference this compiled_contract
// delete all of the rows in sources for the fetched source_hashes which are dangling now
// use standard method for storing the sources of the new verification

// TODO rename verifiedcontractid

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
          AND sm.id IN (4394)
          -- AND sm.id IN (4001,4394,5094,126623,176536,213560,214019,479725,673517,682440,700717,701168,701561,703122,740811,743526,760901,765228,765769,773829,774306,777508,778096,778935,794239,794984,795366,795608,804010,808066,820381,842092,860323,861507,868677,875215,882023,891828,894688,941654,1005021,1031326,1033964,1045218,1052783,1071385,1074373,1086958,1089056,1100033,1101805,1117873,1121031,1125916,1126761,1126770,1129278,1133127,1143108,1146132,1156262,1159078,1159171,1160156,1176050,1181219,1181651,1184244,1184683,1186615,1196955,1197450,1198489,1205693,1216575,1218666,1223284,1223369,1227929,1231406,1234395,1235489,1236746,1237611,1238327,1240504,1241251,1242526,1246442,1247792,1249626,1252138,1259828,1267687,1269782,1271201,1271552,1276963,1280724,1282795,1285705,1287443,1288104,1293540,1296782,1300855,1303026,1305236,1305550,1332831,1334811,1342484,1357790,1366556,1366630,1375965,1381512,1389923,1404216,1412697,1413061,1414161,1415664,1415726,1415821,1427811,1429823,1433619,1435672,1447896,1455013,1470033,1471970,1498390,1512145,1512604,1515102,1519424,1523351,1530350,1554442,1567971,1575598,1580656,1605908,1609871,1624965,1630888,1652060,1653057,1668142,1668696,1685200,1695458,1700449,1721912,1724622,1765712,1779558,1780101,1787948,1789816,1815828,1841287,1843053,1851698,1898672,1906090,1914900,1921525,1942522,1947992,1955944,1960678,1962257,1966686,1976408,1983687,1997469,2024156,2025083,2031614,2038838,2063861,2090995,2103197,2123215,2142554,2155936,2177650,2200832,2201140,2204435,2205127,2210700,2233512,2235622,2239806,2250468,2251171,2261779,2268177,2310168,2319298,2324658,2329515,2334096,2336942,2337409,2346146,2365060,2390545,2402617,2402793,2420842,2429029,2438778,2491856,2500624,2520283,2522660,2525870,2551114,2556323,2574051,2578317,2606923,2653305,2679727,2710867,2753637,2802835,2823993,2884585,2927763,2949212,2967058,2992738,3022304,3108506,3116411,3195245,3230615,3246951,3301597,3310152,3312812,3358581,3476241,3484832,3486582,3493182,3532104,3538174,3547528,3556783,3579645,3639778,3648043,3653085,3661498,3679565,3707181,3710756,3726878,3760095,3783268,3794146,3804636,3805068,3896259,3931826,3999124,4032873,4052894,4141138,4155487,4165410,4195607,4280866,4281520,4301506,4316518,4330210,4336232,4355428,4361241,4409711,4939505,4941548,5024608,5107321,5118626,5120446,5122498,5157600,5166814,5172541,5173259,5187412,5187818,5198799,5198865,5204303,5222086,5222549)
      GROUP BY sm.id, vc.id, cc.id, cd.id
      ORDER BY sm.id ASC
      LIMIT $1
    `,
      [n],
    );
  },
  buildRequestBody: (contract) => {
    const request = {
      chainId: contract.chain_id.toString(),
      address: `0x${contract.address.toString("hex")}`,
      forceCompilation: true,
      jsonInput: contract.std_json_input,
      compilerVersion: contract.compiler_version,
      compilationTarget: contract.fully_qualified_name,
      forceRPCRequest: false,
      customReplaceMethod: "replace-metadata",
    };
    console.log(request.compilerVersion);
    return request;
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
