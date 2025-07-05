"use strict";

var async = require("async");

var dbm;
var type;
var seed;

/**
 * We receive the dbmigrate dependency from dbmigrate initially.
 * This enables us to not have to rely on NODE_PATH.
 */
exports.setup = function (options, seedLink) {
  dbm = options.dbmigrate;
  type = dbm.dataType;
  seed = seedLink;
};

exports.up = function (db, callback) {
  async.series(
    [
      db.runSql.bind(
        db,
        `ALTER TABLE contracts ALTER COLUMN creation_code_hash DROP NOT NULL;`,
      ),
      db.runSql.bind(
        db,
        `ALTER TABLE contract_deployments ALTER COLUMN transaction_hash DROP NOT NULL;
        ALTER TABLE contract_deployments ALTER COLUMN block_number DROP NOT NULL;
        ALTER TABLE contract_deployments ALTER COLUMN transaction_index DROP NOT NULL;
        ALTER TABLE contract_deployments ALTER COLUMN deployer DROP NOT NULL;
        ALTER TABLE contract_deployments DROP CONSTRAINT IF EXISTS contract_deployments_pseudo_pkey;
        ALTER TABLE contract_deployments ADD CONSTRAINT contract_deployments_pseudo_pkey UNIQUE (chain_id, address, transaction_hash, contract_id);`,
      ),
      db.runSql.bind(
        db,
        `ALTER TABLE compiled_contracts ALTER COLUMN creation_code_hash DROP NOT NULL;
        ALTER TABLE compiled_contracts ALTER COLUMN creation_code_artifacts DROP NOT NULL;
        ALTER TABLE compiled_contracts DROP CONSTRAINT compiled_contracts_pseudo_pkey;
        ALTER TABLE compiled_contracts ADD CONSTRAINT compiled_contracts_pseudo_pkey UNIQUE NULLS NOT DISTINCT (compiler, language, creation_code_hash, runtime_code_hash);`,
      ),
      db.runSql.bind(
        db,
        `CREATE TABLE sourcify_matches (
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
        ALTER TABLE sourcify_matches ADD CONSTRAINT sourcify_matches_verified_contract_id_fk FOREIGN KEY (verified_contract_id) REFERENCES verified_contracts(id) ON DELETE RESTRICT ON UPDATE RESTRICT;`,
      ),
      db.runSql.bind(
        db,
        `
        CREATE TRIGGER update_set_updated_at
            BEFORE UPDATE ON sourcify_matches
            FOR EACH ROW
            EXECUTE FUNCTION trigger_set_updated_at();
        `,
      ),
      db.runSql.bind(
        db,
        `CREATE TABLE sourcify_sync (
            id BIGSERIAL NOT NULL,
            chain_id numeric NOT NULL,
            address bytea NOT NULL,
            match_type varchar NOT NULL,
            synced bool NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT sourcify_sync_pkey PRIMARY KEY (id),
            CONSTRAINT sourcify_sync_pseudo_pkey UNIQUE (chain_id, address)
        );`,
      ),
      db.runSql.bind(
        db,
        `CREATE TABLE "session" (
            "sid" varchar NOT NULL COLLATE "default",
            "sess" json NOT NULL,
            "expire" timestamp(6) NOT NULL
        ) WITH (OIDS=FALSE);
        ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
        CREATE INDEX "IDX_session_expire" ON "session" ("expire");`,
      ),
      // Add verification job tables
      db.runSql.bind(
        db,
        `CREATE TABLE verification_jobs (
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
        CREATE INDEX verification_jobs_chain_id_address_idx ON verification_jobs USING btree (chain_id, contract_address);`,
      ),
      db.runSql.bind(
        db,
        `CREATE TABLE verification_jobs_ephemeral (
            id uuid NOT NULL DEFAULT gen_random_uuid(),
            recompiled_creation_code bytea,
            recompiled_runtime_code bytea,
            onchain_creation_code bytea,
            onchain_runtime_code bytea,
            creation_transaction_hash bytea,
            CONSTRAINT verification_jobs_ephemeral_pkey PRIMARY KEY (id),
            CONSTRAINT verification_jobs_ephemeral_id_fk FOREIGN KEY (id) REFERENCES verification_jobs(id) ON DELETE CASCADE ON UPDATE CASCADE
        );`,
      ),
    ],
    callback,
  );
};

exports.down = function (db, callback) {
  async.series(
    [
      db.dropTable.bind(db, "verification_jobs_ephemeral"),
      db.dropTable.bind(db, "verification_jobs"),
      db.dropTable.bind(db, "session"),
      db.dropTable.bind(db, "sourcify_sync"),
      db.dropTable.bind(db, "sourcify_matches"),
      db.runSql.bind(db, "DELETE FROM verified_contracts;"),
      db.runSql.bind(db, "DELETE FROM contract_deployments;"),
      db.runSql.bind(db, "DELETE FROM compiled_contracts;"),
      db.runSql.bind(db, "DELETE FROM contracts;"),
      db.runSql.bind(db, "DELETE FROM code;"),
      db.runSql.bind(
        db,
        `ALTER TABLE compiled_contracts DROP CONSTRAINT compiled_contracts_pseudo_pkey;
        ALTER TABLE compiled_contracts ADD CONSTRAINT compiled_contracts_pseudo_pkey UNIQUE (compiler, language, creation_code_hash, runtime_code_hash);
        ALTER TABLE compiled_contracts ALTER COLUMN creation_code_artifacts SET NOT NULL;
        ALTER TABLE compiled_contracts ALTER COLUMN creation_code_hash SET NOT NULL;`,
      ),
      db.runSql.bind(
        db,
        `ALTER TABLE contract_deployments ALTER COLUMN deployer SET NOT NULL;
        ALTER TABLE contract_deployments ALTER COLUMN transaction_index SET NOT NULL;
        ALTER TABLE contract_deployments ALTER COLUMN block_number SET NOT NULL;
        ALTER TABLE contract_deployments ALTER COLUMN transaction_hash SET NOT NULL;
        ALTER TABLE contract_deployments DROP CONSTRAINT IF EXISTS contract_deployments_pseudo_pkey;
        ALTER TABLE contract_deployments ADD CONSTRAINT contract_deployments_pseudo_pkey UNIQUE (chain_id, address, transaction_hash);`,
      ),
      db.runSql.bind(
        db,
        `ALTER TABLE contracts ALTER COLUMN creation_code_hash SET NOT NULL;`,
      ),
    ],
    callback,
  );
};
