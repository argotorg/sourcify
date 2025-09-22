-- migrate:up

-- Enable pg_trgm extension for trigram text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add trigram GIN index for fast LIKE pattern matching on signature column
-- This handles both exact matches and wildcard searches efficiently
-- Note: Using LIKE (case-sensitive) not ILIKE
CREATE INDEX signatures_signature_trgm_idx
ON signatures USING GIN (signature gin_trgm_ops);

-- migrate:down

-- Remove the indexes
DROP INDEX IF EXISTS signatures_signature_trgm_idx;