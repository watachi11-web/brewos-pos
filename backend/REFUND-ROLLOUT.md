# Refund rollout — v6.2.4-REFUND-GUARD

## Validated release (2026-10-09)

**Production rollout is blocked, not complete.** Activation failed before the
schema batch was committed (`The caller does not have permission`). The production
Google Sheet displays `Can't create, edit, or upload` / `Not enough storage`.
The owner must free storage and restore editing first; do not purchase storage,
delete personal files, bypass this check, deploy the backend, or merge the
dependent frontend while blocked. Existing deployed version remains unchanged.
After storage is resolved, recheck file access, rerun activation and verify the
empty journal, then deploy the exact tested release without the editor runner,
merge the frontend, and compare production accounting/stock before and after.

Validation completed before production rollout:

- 116 local tests passed, with no skips in the reviewed production workspace.
- 25 checks passed in an isolated Google Sheets runtime on 2026-10-09, including report consistency, duplicate prevention, pending-operation recovery, and atomic batch rejection. No real sales/refunds were used as tests.
- Tested release fingerprint: `1fa8ca59ba49daf24c5c7f5b701ea426c2b8e7d2387c510362728ba3415e07af`.

Implementation:

- The release builder integrates HTTP and hosted entry points, a reentrant execution-local adapter around the existing script lock, and guards all order/inventory/day-close writers. Legacy current-recipe cancellation is retired explicitly.
- Finance, Daily Close (including persisted close totals), Dashboard, inventory usage, and Reports use committed refund COGS under the same locked snapshot. Monthly Control inherits the same Finance/Daily Close APIs. No Month Lock or Login has been added.
- Orders has a server preview, explicit prepared/unprepared choice, original-channel manual-refund confirmation, durable operation IDs, cross-tab exclusion, and read-back recovery. The app never transfers money. Mixed-brand bills are refunded in full, not one child at a time. Only the current open business day is supported.
- Reports includes retained non-cash COGS in totals, brands, daily rows, charts, and CSV. Product rankings deliberately represent active sales and label the separately retained refund cost.
- The private builder requires the exact reviewed production baseline hash. It emits a release hash. Activation requires a successful isolated runtime test with that exact hash, creates only the new journal schema, and changes no business rows.
- Local checks: `node --test tests/*.test.cjs`. Tests needing the private backend use `BREWOS_BASELINE`; they explicitly skip on a clean public checkout without that file. Do not publish the private production baseline.
- The editor runner file is temporary and MUST NOT be included in a deployment. Its functions are not included by the builder. Remove the appended runner before publishing a version.

## Unknown-result recovery

1. Stop issuing further refund attempts. Keep browser storage and the original RFD number. Do not refund the customer again. The durable server fence blocks conflicting business writes and closing the day.
2. Use **ตรวจผลคืนเงินค้าง**. Only a positively verified committed record allows an identical acknowledgment; no second business write occurs. An absent/pending record never causes an automatic retry or fence reset.
3. For pending/absent records, pause POS clients and inspect Apps Script Executions. An operator must verify the original executions are terminal and all Sheets requests have settled. Retain the journal/fence evidence with `brewRefundInspectPending_`. Never delete properties or journal rows to bypass a lock.
4. After at least 15 minutes from the original intent, an operator may call private `brewRefundReconcilePending_` from an editor-only temporary runner, with the exact confirmation `FINISH <RFD-ID> EXECUTIONS TERMINAL AND POS PAUSED`. The wait is additional protection, not proof of settlement. There is no public recovery-write endpoint.
5. Recovery revalidates paid/open/same-day state and the original ledger. A pending plan must exactly match the new server snapshot. It completes that SAME intent atomically, verifies the committed result, then clears only its matching fence. A lost response preserves the fence again. Changed/cross-day evidence remains blocked for a separately approved manual repair; do not force it.
6. Remove any temporary runner before deployment. Verify the recorded result from Orders and the reports before resuming sales.

Known operating boundary: a script lock cannot stop direct manual spreadsheet edits. Do not edit source cells while POS/refund requests are running. This is an owner-operated public API at the owner's explicit request, not an authenticated multi-user system.

## Earlier staging record (superseded by the integrated release above)

These modules are **not a production refund endpoint**. No HTML or existing API loads them. Tests use synthetic data only. The Apps Script adapter deliberately returns `REFUNDS_NOT_ENABLED`.

## Implemented and tested locally

- `refund-plan.js`: validates the server snapshot and calculates the full refund.
- `refund-commit.js`: script-lock orchestration, canonical request fingerprint, durable pre-request fence, intent reservation, atomic commit, and authoritative read-back. Unknown results are never replayed. A committed identical retry only returns the recorded result.
- `refund-batch.js`: typed Sheets v4 update/append requests for order state, ingredient balances/WAC, stock reversal audit rows and committed operation status. Only `userEnteredValue` changes; unrelated formatting/formulas are untouched. Text cannot become a formula.
- `refund-report.js`: shared projection for retained non-cash COGS, with duplicate/pending/corrupt record guards and prevention of double application. Payment metadata is explicitly all-brand transaction scope, even when filtering consumed cost by brand.
- `refund-service.gs`: private Apps Script storage adapter using the enabled Sheets service. Journal read-back uses Sheets API, not a potentially stale SpreadsheetApp cache. Missing schemas, unknown days and duplicate close records fail closed.

The local tests simulate failure at every atomic request boundary, lost reservation/commit responses, invisible in-flight reservation, lock contention, request conflicts, direct Apps Script adapter behavior and cost projections. They do **not** establish actual Google runtime behavior or prove that the existing production reports are integrated.

## Supported first-release boundary

- Full transaction only (both BB/HH children for a mixed-brand bill).
- Same business day, confirmed open/reopened. Never silently reopen a closed day.
- Owner confirms the manual refund through the original payment channel. This app does not transfer money.
- Unprepared: reverse original stock deduction quantities and values, recomputing WAC from current stock value plus original returned value. Never use current recipes to reconstruct the past.
- Prepared: do not restore stock; retain the original full line cost (already includes modifiers/sub-recipes) exactly once, with no fabricated cash expense.
- Reject missing or inconsistent historical evidence; do not infer zero, current recipe cost, or a mass/volume conversion.
- Login is explicitly out of scope at the owner's request. Preserve existing access controls; do not describe a public endpoint as secured.

## Required before enabling any new write

1. Read a complete server snapshot while holding the existing script write lock. Adapt `created_at` to Bangkok `business_date` and supply explicit day-lock evidence. Never accept these facts from client JSON.
2. Provide durable operation records with request fingerprints. Same operation/body committed => read-back original result, changed body => conflict, pending/unknown => reconciliation required, never replay blindly.
3. Atomically persist order statuses, original-transaction-linked stock reversals, ingredient balances/WAC, and refund cost records; a multi-cell SpreadsheetApp sequence is not an atomic commit. Validate the chosen atomic storage mechanism and permissions before deployment. If this cannot be guaranteed, keep the write route disabled.
4. Make Finance, Daily Close, Dashboard, order reports and Monthly Control use the same committed refund cost records. `cogs_delta` for a prepared refund is zero relative to the original sale: removing sale COGS requires adding `consumed_cost_retained` once. Never also post this as a cash expense.
   Read sales and refund records in a consistent snapshot: a refund committing between the two reads must not double-count costs. Account for nested close-day calls that already hold the script lock; do not introduce a reentrant-lock deadlock.
5. Refuse closing a day or further conflicting stock operations while any refund has an unresolved result. Surface the pending status to the owner instead of a success toast.
6. Test real adapter behavior in isolated storage: lock contention, mixed brands, interruptions at each write boundary, retries/lost response, concurrent purchase, altered recipes, negative stock, closed dates, payment totals, and all four report totals.
7. Deploy compatible backend + frontend together only after those integration tests pass. Retain/restrict the legacy cancellation path deliberately; do not leave it bypassing the new validations.

8. Provision and verify the `refund_operations` schema in isolated storage first. No schema bootstrap runs automatically from a public route. Test atomic writes against Google Sheets in that isolated environment before any production activation.

9. Reconciliation is still to be implemented: a durable fence must not be removed merely because a timed-out operation is currently absent. A committed read-back can clear the matching fence; any absent/pending case requires an explicit verified recovery workflow. Until then, keep the feature off.

The pure planner does not itself prove transactional safety or report integration. Do not mark refunds complete or deploy merely because its unit tests pass.

## Storage mechanism selected for integration

Google Sheets `spreadsheets.batchUpdate` can commit the related cell updates and appended audit rows together, or reject the whole batch. Keep a script lock around the server snapshot and batch; this does not protect against manual spreadsheet edits, which need separate operational coordination. Use the Advanced Sheets service, not an OAuth token exposed to the browser.

On 2026-10-08 the owner explicitly accepted the Google API terms and approved service activation. **Google Sheets API v4**, identifier **Sheets**, was added to the existing Apps Script project and saved. The editor confirmed `service added.` and displayed Sheets under Service Dependencies. No Billing, card, OAuth Login setup, backend code replacement, business-data write, or new deployment was performed. This confirms the dependency configuration only; adapter runtime and atomic write tests are still required before release. Do not resume abandoned Login/OAuth branding setup.

Standard Sheets API usage has no additional charge; quota/pricing can change. Honor the owner's free-only constraint: no Billing, paid quota expansion, card, or paid service. Pause if Google requires one.

References: [atomic batch updates](https://developers.google.com/workspace/sheets/api/guides/batchupdate), [enable Advanced services with the existing default project](https://developers.google.com/apps-script/guides/services/advanced), [usage limits/pricing](https://developers.google.com/workspace/sheets/api/limits).
