-- migrate:up

-- Cleanup functions for verification jobs, see https://github.com/argotorg/sourcify/issues/3028
-- Nothing calls them yet: the schedule comes when the archive of both tables works.
-- PL/pgSQL, so that Postgres plans the deletes with the real cutoff and limit. max_rows caps one call.

-- The ephemeral rows go with the jobs through ON DELETE CASCADE.
CREATE OR REPLACE FUNCTION public.delete_expired_verification_jobs(retention interval DEFAULT '90 days'::interval, max_rows integer DEFAULT 100000) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.verification_jobs
  -- ctid = ANY(ARRAY(...)) fetches only these rows; id IN (...) can scan the full table
  WHERE ctid = ANY (ARRAY(
    SELECT ctid
    FROM public.verification_jobs
    WHERE started_at < NOW() - retention
    ORDER BY started_at
    LIMIT max_rows
  ));
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- 30 days gives margin if an export to the archive fails.
CREATE OR REPLACE FUNCTION public.delete_expired_verification_jobs_ephemeral(retention interval DEFAULT '30 days'::interval, max_rows integer DEFAULT 100000) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM public.verification_jobs_ephemeral
  WHERE ctid = ANY (ARRAY(
    SELECT ephemeral.ctid
    FROM public.verification_jobs_ephemeral ephemeral
    -- A scalar subquery, so that each job is a primary key lookup and never a table scan
    WHERE (
      SELECT started_at FROM public.verification_jobs WHERE id = ephemeral.id
    ) < NOW() - retention
    LIMIT max_rows
  ));
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;

-- migrate:down

DROP FUNCTION IF EXISTS public.delete_expired_verification_jobs_ephemeral(interval, integer);
DROP FUNCTION IF EXISTS public.delete_expired_verification_jobs(interval, integer);
