## before

- Run this query on the production database. It must return no rows. A returned row is a stored Vyper version that the strict version check rejects. In that case, extend `isValidVyperVersion` in `packages/compilers-types/src/VyperTypes.ts` before the release.

  ```sql
  SELECT DISTINCT version FROM compiled_contracts
  WHERE language = 'vyper'
    AND version !~ '^\d+\.\d+\.\d+((a|b|rc)\d+|-beta\.\d+)?(\+commit\.[0-9a-f]{7,40})?$';
  ```
