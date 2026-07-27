# Cloud Run deployment outline

Planned services:

- `zvedeno-web`: Next.js web application and OAuth callbacks.
- `zvedeno-worker`: container used by Cloud Run Jobs.

Planned jobs:

```text
sync-meta       current day / yesterday updates
refresh-history rolling attribution lookback
sync-sheets     apply changed rows to Google reports
health-check    detect stale accounts, tokens and deleted sheets
```

Do not deploy real credentials from files. Use environment variables backed by Secret Manager.
