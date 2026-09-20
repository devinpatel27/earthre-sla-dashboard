# EarthRe SLA Monitoring Dashboard

Single-screen SLA dashboard for the EarthRe full-stack case study. Users upload a monitoring CSV, a deployed serverless function validates and cleans it, the cleaned checks are persisted, and the UI exposes SLA stats plus filterable raw logs.

## Architecture

- UI: Next.js App Router page at `/`, deployable on Vercel's free tier.
- Stateless processing: `POST /api/upload` is a serverless route. It receives the uploaded CSV, parses it, validates each row, normalizes latency, deduplicates checks, and saves one upload batch.
- Persistence: production uses Postgres through `DATABASE_URL` (Neon, Supabase, or Vercel Postgres all work on a free tier). Local development falls back to `.data/earthre-monitoring.json` so reviewers can run it without provisioning a database.
- Dashboard querying: `GET /api/dashboard` reads the latest persisted batch and applies a single-date or date-range filter before returning stats and up to 500 log rows.

I chose this shape because the assignment cares about the upload -> cloud function -> database -> dashboard flow. Next.js keeps the UI and cloud function in one deployable repo while still giving a real stateless serverless boundary.

## Data Findings

Across the provided datasets I found these quality issues:

- Mixed latency units: some rows use `ms`, and all `svc-search` rows use `s`. I convert seconds to milliseconds before calculating latency stats.
- Missing latency: every file has missing latency values. I keep those rows with `latencyMs = null` because availability is driven by status code, and dropping them would undercount checks.
- Invalid timestamps: each file has timestamp values that cannot be parsed. I reject those rows because they cannot be queried by date or placed in the incident timeline.
- Duplicate checks: each file has duplicate `(service_id, timestamp, agent, region)` records. I keep the first and drop later duplicates.
- Invalid status code: each file has one `999` status. I reject status codes outside the HTTP `100-599` range.
- Negative latency: each file has one negative latency. I reject it because latency cannot be negative.
- Rows are not sorted chronologically. I sort cleaned checks by timestamp for persistence and return logs newest first.

Observed file ranges:

| File | Rows | UTC range |
| --- | ---: | --- |
| `monitoring_checks_9d_seed101.csv` | 4,672 | 2025-05-08 to 2025-05-16 |
| `monitoring_checks_12d_seed505.csv` | 6,230 | 2025-04-10 to 2025-04-21 |
| `monitoring_checks_14d_seed202.csv` | 7,269 | 2025-05-19 to 2025-06-01 |
| `monitoring_checks_21d_seed303.csv` | 10,904 | 2025-04-03 to 2025-04-23 |
| `monitoring_checks_30d_seed404.csv` | 15,577 | 2025-04-06 to 2025-05-05 |

## Assumptions

- Availability is calculated as `2xx/3xx checks / total valid checks`. `4xx` and `5xx` would count as down. The given data mostly uses `200`, `500`, `502`, and `503`.
- SLA risk is flagged below `99.9%` over the currently selected filter window.
- Date filters are evaluated in UTC because the timestamps are UTC (`Z`) and billing/SLA pipelines should avoid browser-local timezone drift.
- The dashboard shows latest uploaded batch only. Multi-upload history is persisted, but selecting older uploads is outside the stated scope.
- The logs table returns the first 500 filtered rows to keep the page responsive. The stats are calculated over the whole filtered batch.

## Live URL

Add the deployed URL here before submission:

https://earthre-sla-dashboard-lyart.vercel.app

Last verified live: `20 September 2026`.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, upload one of the CSVs from the case-study folder, and use the filters below the stats panel.

Without `DATABASE_URL`, local uploads are stored in `.data/earthre-monitoring.json`.

## Deploy

1. Push this repository to GitHub.
2. Create a free Postgres database, for example Neon or Supabase.
3. Deploy the repo on Vercel.
4. Add environment variables:

```bash
DATABASE_URL=postgres://...
DATABASE_SSL=true
```

5. Upload a CSV on the live site and confirm the dashboard reloads after refresh.

The schema is created automatically by the app on first upload/query.

## What I Would Do Differently With More Time

- Add pagination and server-side sorting for the logs table.
- Add a batch-history selector so support can compare uploads.
- Add automated tests around the cleaner for each data-quality issue.
- Add charts for incident windows and service-level error-budget burn.
- Move bulk inserts to batched SQL or `COPY` for very large files.

## Face-to-Face Explanation Notes

- Start with the pipeline: "The browser sends the CSV to a stateless serverless route. That route cleans the data and persists a batch. The dashboard never trusts in-memory upload state; it queries persisted data."
- Cleaning choices to defend: invalid timestamps are rejected, invalid HTTP statuses are rejected, duplicates are dropped by service/timestamp/agent/region, seconds are normalized to milliseconds, and missing latency is kept as null so it does not distort availability.
- Stats choice: availability, failed checks, SLA threshold, P95 latency, and per-service cards are the most useful for billing and on-call triage because they answer "Did we breach?", "Who breached?", and "Can I inspect the raw checks?"
- Tradeoff: the current UI focuses on the latest upload for simplicity. The database model keeps batch IDs, so adding historical comparison is straightforward.
