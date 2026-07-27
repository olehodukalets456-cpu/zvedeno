# Delivery roadmap

This is an implementation order, not a reduced product scope.

## Phase 1 — foundation

- [x] Monorepo and application boundaries
- [x] Multi-tenant-ready PostgreSQL schema
- [x] Report recipe types
- [x] Creative-name normalization rule
- [x] Web and worker shells
- [ ] Install dependencies and generate initial migration
- [ ] Provision development PostgreSQL / Neon

## Phase 2 — Meta connection

- [ ] Meta developer app configuration
- [ ] Encrypted token storage
- [ ] Account discovery
- [ ] Campaign, ad set, ad and creative sync
- [ ] Pagination, retry and rate-limit handling
- [ ] Sync status screen

## Phase 3 — persistent insights

- [ ] Daily Insights API ingestion
- [ ] Stable UPSERT key
- [ ] Historical backfill
- [ ] Rolling 28-day attribution refresh
- [ ] Account-blocked state and replacement-account flow

## Phase 4 — classification and flexible results

- [ ] Scan names, objectives, URLs, forms, pages and pixels
- [ ] Suggested project/direction mappings
- [ ] Manual overrides
- [ ] Generic result-definition builder
- [ ] Unknown-event review queue

## Phase 5 — creatives

- [ ] Stable thumbnail archive
- [ ] Image and video metadata
- [ ] Aggregate same-name creatives across ad accounts
- [ ] Same-name / different-media conflict screen
- [ ] By Ad and By Creative views
- [ ] Daily, weekly and monthly creative performance

## Phase 6 — Google reporting

- [ ] Google OAuth
- [ ] Create formatted spreadsheet
- [ ] Dashboard, Campaigns, Daily, Monthly, Creatives, Funnel and Sync Status tabs
- [ ] Hidden stable row keys
- [ ] Append new data and update changed data
- [ ] Preserve manual columns
- [ ] Weekly / monthly snapshots

## Phase 7 — reliability and deployment

- [ ] Cloud Run web and worker services
- [ ] Scheduled jobs
- [ ] Secret Manager
- [ ] Object storage
- [ ] Telegram error alerts
- [ ] Backups and restore drill
- [ ] CI/CD deployment

## Phase 8 — future public access

- [ ] User registration
- [ ] Workspace invitations and roles
- [ ] Meta and Google connections per workspace
- [ ] Privacy policy, terms and account deletion
- [ ] OAuth verification and Meta App Review
- [ ] Usage limits and optional billing
