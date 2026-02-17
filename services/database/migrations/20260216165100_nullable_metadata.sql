-- migrate:up

ALTER TABLE sourcify_matches ALTER COLUMN metadata DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_compilation_artifacts_sources_internal(obj jsonb) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    are_object_values_valid bool;
    are_ids_unique          bool;
BEGIN
    SELECT bool_and (
        -- file name must be non-empty string
       length(key) > 0 AND
       -- the corresponding value is expected to be an object with only the 'id' key
       is_jsonb_object(value) AND
       validate_json_object_keys(value, array ['id'], array []::text[]) AND
       -- the value of 'id' key is expected to be a non-negative integer
       -- represented either as number (0) or string ("0")
       (is_jsonb_number(value -> 'id') OR is_jsonb_string(value -> 'id')) AND
       (value->>'id') ~ '^[0-9]+$'
    )
    INTO are_object_values_valid
    FROM jsonb_each(obj);

    SELECT count(value -> 'id') = count(DISTINCT ((value->>'id')::int))
    INTO are_ids_unique
    FROM jsonb_each(obj);

    RETURN are_object_values_valid AND are_ids_unique;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_compilation_artifacts(obj jsonb) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN
        is_jsonb_object(obj) AND
        validate_json_object_keys(
            obj,
            array ['abi', 'sources'],
            array ['userdoc', 'devdoc', 'storageLayout']
        ) AND
        validate_compilation_artifacts_abi(obj -> 'abi') AND
        validate_compilation_artifacts_sources(obj -> 'sources');
END;
$$;

-- migrate:down

ALTER TABLE sourcify_matches ALTER COLUMN metadata SET NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_compilation_artifacts_sources_internal(obj jsonb) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
    are_object_values_valid bool;
    are_ids_unique          bool;
BEGIN
    SELECT bool_and (
        -- file name must be non-empty string
       length(key) > 0 AND
       -- the corresponding value is expected to be an object with only the 'id' key
       is_jsonb_object(value) AND
       validate_json_object_keys(value, array ['id'], array []::text[]) AND
       -- the value of 'id' key is expected to be a non-negative integer
       is_jsonb_number(value -> 'id') AND
       (value->>'id')::int >= 0
    )
    INTO are_object_values_valid
    FROM jsonb_each(obj);

    SELECT count(value -> 'id') = count(DISTINCT value -> 'id')
    INTO are_ids_unique
    FROM jsonb_each(obj);

    RETURN are_object_values_valid AND are_ids_unique;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_compilation_artifacts(obj jsonb) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN
        is_jsonb_object(obj) AND
        validate_json_object_keys(
            obj,
            array ['abi', 'userdoc', 'devdoc', 'sources', 'storageLayout'],
            array []::text[]
        ) AND
        validate_compilation_artifacts_abi(obj -> 'abi') AND
        validate_compilation_artifacts_sources(obj -> 'sources');
END;
$$;
