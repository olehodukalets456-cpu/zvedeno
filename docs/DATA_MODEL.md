# Data model notes

## Stable hierarchy

```text
Workspace
  └─ Client
      └─ Project
          ├─ Meta account A (archived)
          ├─ Meta account B (active)
          └─ Report recipe
```

An ad account is a source, not the owner of a report.

## Daily facts

Meta Insights are stored at daily granularity. Every normalized API row receives a deterministic `fact_key` built from:

```text
project_id
+ ad_account_id
+ insight_date
+ entity_level
+ entity_external_id
+ breakdown_hash
+ attribution_setting
```

`fact_key` is stored as a non-null value and is unique inside a workspace. This avoids PostgreSQL null semantics creating duplicate facts for account-, campaign-, ad set- or ad-level rows.

The relational `campaign_id`, `adset_id`, `ad_id` and `media_asset_id` columns remain available for filtering and aggregation, but the generated fact key is the UPSERT identity.

This supports safe re-fetching of recent days for late conversions without duplicating spend or results.

## Flexible metrics and results

Meta and external systems expose many vertical-specific events. Core identifiers stay relational, while metric payloads and breakdowns are stored as JSONB to avoid schema changes for every new result type.

Result definitions map source events to business meaning, for example:

- `actions:lead` → Meta lead;
- `actions:onsite_conversion.messaging_conversation_started_7d` → messaging conversation;
- Telegram invite source → channel subscription;
- CRM stage → qualified lead;
- SMS provider event → SMS conversation.

## Report recipes

A recipe is a versioned configuration containing accounts, project mappings, result definitions, metrics, funnel steps, period, refresh schedule, sheet tabs and manual columns.

## Creative model

- `ads` preserve every Meta launch and external ID.
- `media_assets` represent a project-level client-facing creative.
- `ad_media_assets` connects all launches to an asset.
- `daily_insights.media_asset_id` allows creative aggregation over time.

The default asset key is the normalized ad/creative name inside a project. Hashes and video IDs are validation signals, not the primary user workflow.
