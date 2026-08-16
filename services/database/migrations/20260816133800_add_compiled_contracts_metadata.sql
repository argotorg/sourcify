-- migrate:up

CREATE TABLE compiled_contracts_metadata (
  compilation_id uuid PRIMARY KEY REFERENCES compiled_contracts(id) ON DELETE CASCADE,
  metadata json NOT NULL
);

-- Backfill metadata from sourcify_matches.
-- We use DISTINCT ON (compilation_id) to ensure we only keep the "first" metadata variant per compilation, 
-- which matches the logic used for source files. We also ensure we only insert metadata that is NOT NULL.
INSERT INTO compiled_contracts_metadata (compilation_id, metadata)
SELECT DISTINCT ON (vc.compilation_id)
  vc.compilation_id,
  sm.metadata
FROM sourcify_matches sm
JOIN verified_contracts vc ON vc.id = sm.verified_contract_id
WHERE sm.metadata IS NOT NULL
ON CONFLICT (compilation_id) DO NOTHING;

-- migrate:down

DROP TABLE IF EXISTS compiled_contracts_metadata;
