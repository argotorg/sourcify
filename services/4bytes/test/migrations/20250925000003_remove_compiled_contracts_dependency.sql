-- migrate:up

-- Remove dependency on compiled_contracts table for 4bytes service

-- Drop the foreign key constraint (keep the column for mock data)
ALTER TABLE compiled_contracts_signatures
DROP CONSTRAINT IF EXISTS compiled_contracts_signatures_compilation_id_fkey;

-- Drop the stub compiled_contracts table (we don't need it anymore)
DROP TABLE compiled_contracts;

-- migrate:down

-- Recreate stub compiled_contracts table
CREATE TABLE compiled_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT NOW()
);

-- Add back the foreign key constraint
ALTER TABLE compiled_contracts_signatures
ADD CONSTRAINT compiled_contracts_signatures_compilation_id_fkey
FOREIGN KEY (compilation_id) REFERENCES compiled_contracts(id);