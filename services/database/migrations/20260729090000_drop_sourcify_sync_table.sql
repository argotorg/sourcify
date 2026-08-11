-- migrate:up

/*
  sourcify_sync tracked the one-off migration of contracts from the filesystem
  repository into the database. That migration is long complete, and the tooling
  that read and wrote the table was removed along with API v1.
*/

DROP TABLE IF EXISTS sourcify_sync;

-- migrate:down

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
