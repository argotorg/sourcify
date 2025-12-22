-- migrate:up

CREATE INDEX IF NOT EXISTS idx_code_code_first_75
  ON code USING btree (substring(code FROM 1 FOR 75));

-- migrate:down

DROP INDEX IF EXISTS idx_code_code_first_75;

