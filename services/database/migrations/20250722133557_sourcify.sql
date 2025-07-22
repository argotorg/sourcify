-- migrate:up

-- Allow creation_code_hash to be nullable in contracts table
ALTER TABLE contracts ALTER COLUMN creation_code_hash DROP NOT NULL;

-- Allow multiple columns to be nullable in contract_deployments table and update constraints
ALTER TABLE contract_deployments ALTER COLUMN transaction_hash DROP NOT NULL;
ALTER TABLE contract_deployments ALTER COLUMN block_number DROP NOT NULL;
ALTER TABLE contract_deployments ALTER COLUMN transaction_index DROP NOT NULL;
ALTER TABLE contract_deployments ALTER COLUMN deployer DROP NOT NULL;
ALTER TABLE contract_deployments DROP CONSTRAINT IF EXISTS contract_deployments_pseudo_pkey;
ALTER TABLE contract_deployments ADD CONSTRAINT contract_deployments_pseudo_pkey UNIQUE (chain_id, address, transaction_hash, contract_id);

-- Allow nullable columns in compiled_contracts and update constraints
ALTER TABLE compiled_contracts ALTER COLUMN creation_code_hash DROP NOT NULL;
ALTER TABLE compiled_contracts ALTER COLUMN creation_code_artifacts DROP NOT NULL;
ALTER TABLE compiled_contracts DROP CONSTRAINT compiled_contracts_pseudo_pkey;
ALTER TABLE compiled_contracts ADD CONSTRAINT compiled_contracts_pseudo_pkey UNIQUE NULLS NOT DISTINCT (compiler, language, creation_code_hash, runtime_code_hash);

-- Create sourcify_matches table
CREATE TABLE sourcify_matches (
    id BIGSERIAL NOT NULL,
    verified_contract_id BIGSERIAL NOT NULL,
    creation_match varchar NULL,
    runtime_match varchar NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    metadata json NOT NULL,
    CONSTRAINT sourcify_matches_pkey PRIMARY KEY (id),
    CONSTRAINT sourcify_matches_pseudo_pkey UNIQUE (verified_contract_id)
);
CREATE INDEX sourcify_matches_verified_contract_id_idx ON sourcify_matches USING btree (verified_contract_id);
ALTER TABLE sourcify_matches ADD CONSTRAINT sourcify_matches_verified_contract_id_fk FOREIGN KEY (verified_contract_id) REFERENCES verified_contracts(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Create trigger for sourcify_matches updated_at
CREATE TRIGGER update_set_updated_at
    BEFORE UPDATE ON sourcify_matches
    FOR EACH ROW
    EXECUTE FUNCTION trigger_set_updated_at();

-- Create sourcify_sync table
CREATE TABLE sourcify_sync (
    id BIGSERIAL NOT NULL,
    chain_id numeric NOT NULL,
    address bytea NOT NULL,
    match_type varchar NOT NULL,
    synced bool NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sourcify_sync_pkey PRIMARY KEY (id),
    CONSTRAINT sourcify_sync_pseudo_pkey UNIQUE (chain_id, address)
);

-- Create session table
CREATE TABLE "session" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL
) WITH (OIDS=FALSE);
ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX "IDX_session_expire" ON "session" ("expire");

-- Create verification_jobs table
CREATE TABLE verification_jobs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    started_at timestamptz NOT NULL DEFAULT NOW(),
    completed_at timestamptz,
    chain_id bigint NOT NULL,
    contract_address bytea NOT NULL,
    verified_contract_id BIGINT,
    error_code varchar,
    error_id uuid,
    error_data json,
    verification_endpoint varchar NOT NULL,
    hardware varchar,
    compilation_time BIGINT,
    CONSTRAINT verification_jobs_pkey PRIMARY KEY (id),
    CONSTRAINT verification_jobs_verified_contract_id_fk FOREIGN KEY (verified_contract_id) REFERENCES verified_contracts(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX verification_jobs_chain_id_address_idx ON verification_jobs USING btree (chain_id, contract_address);

-- Create verification_jobs_ephemeral table
CREATE TABLE verification_jobs_ephemeral (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    recompiled_creation_code bytea,
    recompiled_runtime_code bytea,
    onchain_creation_code bytea,
    onchain_runtime_code bytea,
    creation_transaction_hash bytea,
    CONSTRAINT verification_jobs_ephemeral_pkey PRIMARY KEY (id),
    CONSTRAINT verification_jobs_ephemeral_id_fk FOREIGN KEY (id) REFERENCES verification_jobs(id) ON DELETE CASCADE ON UPDATE CASCADE
);

-- migrate:down

-- Drop verification tables
DROP TABLE IF EXISTS verification_jobs_ephemeral;
DROP TABLE IF EXISTS verification_jobs;

-- Drop session table
DROP TABLE IF EXISTS "session";

-- Drop sourcify tables
DROP TABLE IF EXISTS sourcify_sync;
DROP TABLE IF EXISTS sourcify_matches;

-- Clear data from main tables
DELETE FROM verified_contracts;
DELETE FROM contract_deployments;
DELETE FROM compiled_contracts;
DELETE FROM contracts;
DELETE FROM code;

-- Revert compiled_contracts constraints and nullability
ALTER TABLE compiled_contracts DROP CONSTRAINT compiled_contracts_pseudo_pkey;
ALTER TABLE compiled_contracts ADD CONSTRAINT compiled_contracts_pseudo_pkey UNIQUE (compiler, language, creation_code_hash, runtime_code_hash);
ALTER TABLE compiled_contracts ALTER COLUMN creation_code_artifacts SET NOT NULL;
ALTER TABLE compiled_contracts ALTER COLUMN creation_code_hash SET NOT NULL;

-- Revert contract_deployments constraints and nullability
ALTER TABLE contract_deployments ALTER COLUMN deployer SET NOT NULL;
ALTER TABLE contract_deployments ALTER COLUMN transaction_index SET NOT NULL;
ALTER TABLE contract_deployments ALTER COLUMN block_number SET NOT NULL;
ALTER TABLE contract_deployments ALTER COLUMN transaction_hash SET NOT NULL;
ALTER TABLE contract_deployments DROP CONSTRAINT IF EXISTS contract_deployments_pseudo_pkey;
ALTER TABLE contract_deployments ADD CONSTRAINT contract_deployments_pseudo_pkey UNIQUE (chain_id, address, transaction_hash);

-- Revert contracts nullability
ALTER TABLE contracts ALTER COLUMN creation_code_hash SET NOT NULL;

