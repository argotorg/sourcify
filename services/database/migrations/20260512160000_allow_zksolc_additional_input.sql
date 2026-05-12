-- migrate:up

CREATE OR REPLACE FUNCTION validate_additional_input(obj jsonb)
    RETURNS boolean AS
$$
BEGIN
    RETURN obj IS NULL OR (
        is_jsonb_object(obj) AND
        validate_json_object_keys(
            obj,
            array []::text[],
            array ['storage_layout_overrides', 'era_solc_version']
        )
    );
END;
$$ LANGUAGE plpgsql;

-- migrate:down

CREATE OR REPLACE FUNCTION validate_additional_input(obj jsonb)
    RETURNS boolean AS
$$
BEGIN
    RETURN obj IS NULL OR (
        is_jsonb_object(obj) AND
        validate_json_object_keys(
            obj,
            array []::text[],
            array ['storage_layout_overrides']
        )
    );
END;
$$ LANGUAGE plpgsql;
