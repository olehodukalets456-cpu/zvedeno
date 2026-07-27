# Architecture

## Goal

Zvedeno is not a one-time exporter. It is a persistent reporting system with PostgreSQL as the source of truth and Google Sheets as a maintained client-facing projection.

```text
Meta Marketing API
        ↓
Scheduled worker / backfill jobs
        ↓
Raw validation + normalization
        ↓
PostgreSQL UPSERT facts
        ↓
Reporting aggregation
        ↓
Google Sheets append + targeted updates
```

## Runtime components

### Web application

The Next.js app owns the simple setup flow:

1. Connect Meta.
2. Select accounts and map them to projects.
3. Select levels, metrics, results, period and refresh frequency.
4. Confirm campaign/project/result mappings.
5. Connect Google and create the report.

Advanced settings are hidden unless needed.

### Worker

The worker executes bounded, retryable jobs:

- account discovery;
- campaign/ad set/ad synchronization;
- Insights backfills;
- creative and thumbnail synchronization;
- recent-attribution refresh;
- Google Sheets mutations;
- health checks and alerts.

A failure in one account must not roll back successful work from other accounts.

### PostgreSQL

PostgreSQL stores all historical and normalized data. Google Sheets is never treated as the only copy of data.

### Object storage

Stable creative thumbnails and optional media archives will be stored outside Meta because source URLs can expire or disappear after account access is lost.

## Multi-tenant boundary

Every user-owned resource is scoped by `workspace_id`. The initial UI can expose only one owner, while the data model remains ready for future registration, teams and roles.

## Synchronization contract

- New facts are inserted.
- Existing recent facts are updated by a stable unique key.
- Missing API rows are not interpreted as deletion.
- Historical facts are never cleared during normal sync.
- Manual report columns are preserved.
- Every run is logged and retryable.

## Project continuity

`project_id` is the reporting identity. A project may have multiple `ad_account_id` sources over time. A blocked account becomes archived; a replacement account is attached to the same project.

## Creative continuity

Raw performance remains separated by account and ad. Client-facing creative performance is aggregated by:

```text
project_id + normalized creative/ad name
```

Normalization only trims whitespace, collapses duplicate spaces and ignores case. Similar but non-identical names are not merged automatically.

If the same normalized name points to a materially different image/video, the service creates a conflict requiring confirmation.
