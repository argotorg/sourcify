-- migrate:up

-- idx_code_code_first_75 served the similarity query of server versions
-- before 4.0.0, which prefix-matched on the code table. The server now
-- reads compiled_contracts_runtime_code_prefixes instead (see
-- https://github.com/argotorg/sourcify/issues/2891). The index was kept as
-- rollback insurance and is no longer needed.
DROP INDEX IF EXISTS idx_code_code_first_75;

-- migrate:down

-- Recreation scans the whole code table; expect several minutes on production.
CREATE INDEX IF NOT EXISTS idx_code_code_first_75
  ON code USING btree (substring(code FROM 1 FOR 75));
