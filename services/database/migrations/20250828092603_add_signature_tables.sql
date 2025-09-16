-- migrate:up

CREATE TYPE signature_type_enum AS ENUM ('function','event','error');

/*
    The `signatures` table stores signature information for compiled_contracts.
    It includes each signature in text and its keccak hash.
*/
CREATE TABLE signatures (
  /* 32 bytes, full keccak of the signature */
  signature_hash_32 BYTEA PRIMARY KEY,

  /* 4 bytes */
  signature_hash_4 BYTEA GENERATED ALWAYS AS (SUBSTRING(signature_hash_32 FROM 1 FOR 4)) STORED,

  /* the signature text, e.g. 'transfer(address,uint256)' */
  signature VARCHAR NOT NULL,

  /* timestamp */
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX signatures_hash_4_idx ON signatures (signature_hash_4);

/*
    The `compiled_contracts_signatures` table links a compiled_contract to its associated signatures.
    It forms a many-to-many relationship.
*/
CREATE TABLE compiled_contracts_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  /* the specific compilation and the specific signature */
  compilation_id UUID NOT NULL REFERENCES compiled_contracts(id),
  signature_hash_32 BYTEA NOT NULL REFERENCES signatures(signature_hash_32),

  /* type of signature: function, event, error */
  signature_type signature_type_enum NOT NULL,

  /* timestamp */
  created_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT compiled_contracts_signatures_pseudo_pkey UNIQUE (compilation_id, signature_hash_32, signature_type)
);

CREATE INDEX compiled_contracts_signatures_signature_idx ON compiled_contracts_signatures (signature_hash_32);
CREATE INDEX compiled_contracts_signatures_type_signature_idx ON compiled_contracts_signatures (signature_type, signature_hash_32);

-- migrate:down

DROP TABLE IF EXISTS compiled_contracts_signatures;
DROP TABLE IF EXISTS signatures;
DROP TYPE IF EXISTS signature_type_enum;
