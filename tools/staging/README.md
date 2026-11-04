# Isolated QA staging

Target: the released 6.2.7 business logic, not a mock implementation.
Create a separate Apps Script project and a new synthetic workbook. No production
workbook copy, customer records, orders, payments, or credentials are seeded.

`build-backend.cjs input.gs output.gs stagingProjectId` requires the exact released
6.2.7 fingerprint, removes its production spreadsheet ID and pins execution to the
new project. Run `initializeStaging` once from the editor after enabling Sheets API.
The initializer refuses to overwrite an existing fixture. If initialization fails,
inspect the partial fixture before repair; do not blindly rerun or delete data.

Deploy a separate web app. `ping` must report `environment: staging` and
`fixture: synthetic-v1`. Then build the frontend:

```
node tools/staging/build-web.cjs /absolute/new/output STAGING_EXEC_URL
```

The generated site replaces API endpoints (including Finance's separate client),
uses a staging storage namespace, shows a persistent test banner and guards every
fetch with backend-identity verification. Never use production URL as this input.
Publish the output in a separate staging directory/site; no production page needs
to be overwritten. Keep the full generated Apps Script private.

## Seed expectations
- QA Food HH: price 30, raw ingredient 125g + 1 package, cost 14.5.
- QA Coffee BB: price 40, raw ingredient 20g + 1 package, cost 4.
- Optional coffee extra: price +5, raw ingredient +10g, cost +1.
- Shared, inactive, deleted and HH-only synthetic customers are provided.
- Raw ingredient starts 100000g at 0.1/g; packaging 1000pcs at 2/pc.
- No sales, refunds, daily closes or kitchen events are preseeded.

## Independent QA sequence
Record run ID, version/release, date (Bangkok), browser, expected/actual and evidence.
Create a fresh named test member in CRM, refresh POS, sell HH/BB products, then
check canonical order identity, sale idempotency, stock deltas and Finance.
In Kitchen, test Making/Ready persistence on two screens, stale-version rejection,
lost-response recovery and cancellation. Compare stock/accounting/close snapshots
before and after kitchen-only operations. Test daily close and reopen only here.
The member cache and historical Pending UX remain known P2 findings; staging is
not a fix for those findings. No automatic loyalty is claimed.

Developer smoke tests are not independent QA signoff. Keep acceptance Conditional
until the QA team runs its own checklist and supplies Pass/Fail evidence.

For Kitchen growth benchmarks, use a disposable synthetic workbook at 100/500/2000
orders and record line/event counts, cold/warm timings and concurrent-screen load.
Do not seed benchmark volume into the shared QA fixture or production.
