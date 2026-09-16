# Disable the S3Repository storage service (#2973)

## after

- Remove `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` from the production and staging Cloud Run services. Keep the `DEBUG_DATA_S3_*` variables, they belong to the debug data upload
- Confirm that `Error storing to S3Repository` and `Failed to store file to S3` lines no longer appear in the logs
