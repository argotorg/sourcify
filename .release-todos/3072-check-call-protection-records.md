## after

Since #3072, the call protection transformation applies only when the onchain runtime code of a library starts with `PUSH20` followed by the address of the contract. Check the existing records against this rule.

- Run this read-only query on the production database. Use a replica, because the query scans `verified_contracts`.

  ```sql
  SELECT cd.chain_id,
         '0x' || encode(cd.address, 'hex') AS address,
         vc.id AS verified_contract_id,
         sm.id AS match_id,
         sm.runtime_match,
         sm.creation_match,
         vc.runtime_values->>'callProtection' AS call_protection,
         '0x' || encode(substring(code.code FROM 1 FOR 21), 'hex') AS onchain_prefix,
         CASE
           WHEN substring(code.code FROM 1 FOR 21) = decode('73' || repeat('00', 20), 'hex') THEN 'zero_placeholder'
           WHEN substring(code.code FROM 1 FOR 1) = decode('73', 'hex') THEN 'other_operand'
           ELSE 'not_push20'
         END AS kind
  FROM verified_contracts vc
  JOIN contract_deployments cd ON cd.id = vc.deployment_id
  JOIN contracts c ON c.id = cd.contract_id
  JOIN code ON code.code_hash = c.runtime_code_hash
  LEFT JOIN sourcify_matches sm ON sm.verified_contract_id = vc.id
  WHERE jsonb_exists(vc.runtime_values, 'callProtection')
    AND (lower(vc.runtime_values->>'callProtection') <> ('0x' || encode(cd.address, 'hex'))
         OR substring(code.code FROM 1 FOR 21) IS DISTINCT FROM (decode('73', 'hex') || cd.address))
  ORDER BY kind, cd.chain_id;
  ```

- If the query returns no rows, there is nothing more to do.
- If the query returns rows, create a follow-up issue to clean up these records. Add the row count for each `kind` to the issue.
- How to read the rows:
  - `match_id` is NULL: no current match uses this row.
  - `zero_placeholder`: the onchain code is equal to the compiler output. The match is still valid, only the stored transformation is not necessary.
  - `other_operand` and `not_push20`: the contract does not verify with the new rule.
