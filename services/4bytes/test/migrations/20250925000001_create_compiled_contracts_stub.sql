-- migrate:up

-- Create minimal compiled_contracts table stub to satisfy foreign key requirements
-- This will be dropped later in the cleanup migration
CREATE TABLE compiled_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT NOW()
);

-- migrate:down

DROP TABLE IF EXISTS compiled_contracts;