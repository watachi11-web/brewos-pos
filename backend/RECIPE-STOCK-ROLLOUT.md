# Atomic sales and raw recipe consumption

Release: `6.2.5-RECIPE-STOCK`. **Not activated in production yet.**
Never publish the generated full Apps Script or hosted mobile HTML: both contain
private installation configuration. Builders accept only the reviewed source hashes.

## Behavior

- The owner selected theoretical raw consumption at sale, with no additional
  manual deduction when preparing the same batch. Nested subrecipes expand by
  declared yields; shared ingredients and selected modifiers aggregate once.
- Unit conversions use the existing server conversion function. Mass, volume,
  whole/prepared food yields and physical balances are never inferred.
- A draft subrecipe with a missing ingredient blocks its own use, not unrelated
  ready menus. Invalid used recipes fail before saving an order.
- Orders, lines, modifiers, balances, consumption ledger and exact result journal
  commit in one Sheets batch under the existing shared lock.
- Costs freeze at sale. History, prices, brand allocation, discounts and closed
  days retain their behavior. Existing shortage warnings remain; negative balances
  are recorded rather than clamped or replaced with invented stock.
- Unprepared refunds reverse the saved ledger. Prepared refunds retain original
  COGS. `completed_at` stays the sale time; refunds have their own journal.
- Trailing computed order-line columns are not overwritten by sale appends.

## Client and recovery

Both POS clients save the exact request before POST using localStorage and Web
Locks. Unknown responses survive reload and block another checkout. A read-only
status check verifies the exact request hash against a committed journal before
an idempotent acknowledgment clears the server fence. Absence never permits replay.
Verified completion notifies other tabs to clear the old cart.

After activation, cached legacy clients get a refresh-required failure before
writes. New clients require `ping.atomic_sales === true`. Coordinate the switch;
do not publish only one side and leave the shop blocked.

An unresolved fence with no committed journal requires operator investigation of
the execution log and all affected sheets. There is no public reset, discard, or
blind retry endpoint. Do not delete a fence merely because time passed.

## Verification

Run `node --test tests/*.test.cjs`. Full generated-backend integration tests use
the private reviewed baseline via `BREWOS_RECIPE_BASELINE`; public CI skips them
when unavailable and must not be described as runtime proof.

`sale-runtime-test.gs`, wrapped with the built candidate inside one editor
function, creates a synthetic spreadsheet. It verifies sale/retry, mixed brands,
discounts, modifiers, refund modes, Finance/Daily Close/inventory, lost responses,
blocked writes and actual all-or-none invalid Sheets batches. Success records a
release-specific proof in `BREWOS_SALE_LAST_TEST`.

`recipe-stock-audit.gs` reads active products and each modifier alternative.
Keep live audit output, physical-count corrections and test screenshots private.
Browser tests must use a synthetic server, never fake production sales.

## Deployment sequence

1. Freeze the candidate, validate scripts, inspect the diff and obtain matching
   runtime proof. Re-read live source hashes before replacing hosted files.
2. Coordinate a brief checkout pause and refresh; preserve any unresolved bill.
3. Save reviewed Backend and hosted mobile candidates. Before deployment, remove
   temporary public test/editor wrappers (retain local backups). Generic admin
   functions end in `_` and cannot be called by `google.script.run`.
4. Run `brewSalePrepareRollout_` from the editor. Under the shared lock it checks
   fences, makes a private full-workbook backup, verifies its shape, and creates
   an empty `sale_operations` journal. It does not change business rows or activate.
5. Publish the compatible web POS and update the existing Apps Script deployment
   URL. Keep API URLs identical. Verify the new release identifier.
6. Run `brewSaleActivate_` from the editor. Matching proof/backup and a fresh live
   variant audit are mandatory. Record the dated cutover and enable it.
7. Verify production ping, menu, history, reports and stock read-only. Refresh both
   POS clients. Do not create fake production sales to test the switch.

## Rollback

Before activation and with no new journal rows, restore saved source/frontend
versions if needed. Keep the backup and empty journal. After any new sale, do not
restore an old workbook or erase the journal: that would discard real sales and
stock movements. Pause checkout and repair forward using journal evidence.

New toast/cracker portions and uncreated ingredients remain a separate data task;
this release does not invent recipes, costs, receipts or counts for them.
