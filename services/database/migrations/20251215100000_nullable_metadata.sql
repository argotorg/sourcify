-- migrate:up

ALTER TABLE sourcify_matches ALTER COLUMN metadata DROP NOT NULL;

-- migrate:down

ALTER TABLE sourcify_matches ALTER COLUMN metadata SET NOT NULL;