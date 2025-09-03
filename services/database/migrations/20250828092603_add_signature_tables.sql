-- migrate:up

CREATE TYPE signature_type_enum AS ENUM ('function','event','error','constructor');

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

  /* type of signature: function, event, error, constructor */
  signature_type signature_type_enum NOT NULL,

  /* timestamps */
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT signatures_pseudo_pkey UNIQUE (signature, signature_type)
);

CREATE INDEX signatures_hash_4_type_idx ON signatures (signature_hash_4, signature_type);

CREATE TRIGGER update_set_updated_at
  BEFORE UPDATE ON signatures
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();

/*
    The `compiled_contracts_signatures` table links a compiled_contract to its associated signatures.
    It forms a many-to-many relationship.
*/
CREATE TABLE compiled_contracts_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  /* the specific compilation and the specific signature */
  compilation_id UUID NOT NULL REFERENCES compiled_contracts(id),
  signature_hash_32 BYTEA NOT NULL REFERENCES signatures(signature_hash_32),

  /* timestamp */
  created_at timestamptz NOT NULL DEFAULT NOW(),

  CONSTRAINT compiled_contracts_signatures_pseudo_pkey UNIQUE (compilation_id, signature_hash_32)
);

CREATE INDEX compiled_contracts_signatures_signature_idx ON compiled_contracts_signatures (signature_hash_32);
CREATE INDEX compiled_contracts_signatures_compilation_idx ON compiled_contracts_signatures (compilation_id);

-- migrate:down

DROP TABLE IF EXISTS compiled_contracts_signatures;
DROP TABLE IF EXISTS signatures;
DROP TYPE IF EXISTS signature_type_enum;
