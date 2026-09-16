# Worker task timeout and runtime stats (#2977)

## before

- Optional: set `WORKER_TASK_TIMEOUT_MS` and `RUNTIME_STATS_INTERVAL_MS` on the production and staging Cloud Run services. When unset, the server uses 1 hour and 60 seconds. `0` disables the respective feature. See `services/server/.env.dev`

## after

- Confirm that a `Worker runtime stats` line appears once a minute in the logs of every instance
- Watch for `Verification worker task timed out` lines. Each one names a job whose input is stored under `failed-verification-inputs/<verificationId>.json` in the debug bucket
