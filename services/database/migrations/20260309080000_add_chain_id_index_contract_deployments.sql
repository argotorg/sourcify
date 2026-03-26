-- migrate:up

-- Add index on contract_deployments.chain_id to speed up
-- the /v2/contracts/{chainId} endpoint pagination query.
-- Without this index, PostgreSQL scans sourcify_matches in ID order and
-- applies the chain_id filter per row via the JOIN, causing full scans
-- when there are large gaps of non-matching-chain IDs.
-- See: https://github.com/argotorg/sourcify/issues/2111
CREATE INDEX contract_deployments_chain_id ON contract_deployments USING btree (chain_id);

-- migrate:down

DROP INDEX IF EXISTS contract_deployments_chain_id;
