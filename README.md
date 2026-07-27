# Zvedeno

Zvedeno is a persistent Meta Ads reporting service that creates and maintains client-ready Google Sheets reports.

The core promise is simple:

> Connect Meta, choose what to export, and keep one living report that does not break when campaigns, creatives or ad accounts change.

## Product principles

- **Project continuity:** a project can use several Meta ad accounts over time. Blocking or replacing an account never deletes history.
- **Incremental sync:** new rows are appended, recent rows are updated when Meta attributes late conversions, and old history is never cleared.
- **Flexible results:** leads, purchases, messages, SMS conversations, clicks, subscriptions, bot starts, CRM stages and custom events are mapped per project or campaign.
- **Creative continuity:** creative performance is aggregated by normalized creative name inside a project, including launches from new ad accounts.
- **Client-ready output:** the service creates and maintains Google Sheets with dashboards, campaign tables, daily data, creatives, funnels and sync status.
- **Simple UI, universal backend:** complex rules live under the hood; the normal flow is a short setup wizard.
- **Multi-tenant ready:** the first version is for one owner, but all user data is scoped by `workspace_id` so registration can be added later.

## Repository structure

```text
apps/
  web/       Next.js control panel and onboarding wizard
  worker/    scheduled Meta sync, backfill and Google Sheets jobs
packages/
  database/       PostgreSQL schema and migrations
  shared/         shared types and utilities
  classification/ project, result and creative-name mapping
  meta-api/       Meta Marketing API adapter
  google-api/     Google Sheets / Drive adapter contracts
  reporting/      report recipes and aggregation rules
docs/             architecture, data model and delivery roadmap
infrastructure/   Cloud Run and container deployment files
```

## Local start

Requirements: Node.js 22+, pnpm and Docker.

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3000`.

## Current status

The repository contains the production-oriented foundation and data model. Meta OAuth, Google OAuth, real synchronization and report generation are the next implementation stages.

## Security

Never commit access tokens, OAuth secrets or database credentials. The repository is currently public, so all real secrets must stay in environment variables / a secret manager.
