# Persistent kitchen — 6.2.7

Preparation state lives in a separate append-only `kitchen_events` sheet. It never
changes financial order status, stock, payment or daily-close data. Each transition
has an operation ID and expected version. A shared lock serializes it with sale and
refund writes. Replaying an operation is safe, and stale screens must refresh.
Cancelled/refunded orders are shown in a cancellation notice and cannot advance.

The kitchen page polls every 15 seconds, uses server Bangkok dates, and offers a
date picker for earlier queues. Refresh retains status. Pending network writes are
stored locally and retried with the original operation ID; no optimistic status
change is shown. Notes, modifiers and quantities are included and escaped.
`owner-no-login` is a source label, not an authenticated identity.

Deployment: run the isolated runtime fixture; back up the production workbook;
create `kitchen_events` with the exact headers in kitchen-service.gs; deploy the
backend before publishing kitchen.html. No historical state can be reconstructed
from the old browser-only workflow: orders without an event start as Pending.
Rollback the frontend/backend to the prior release if needed; retain the event
sheet for recovery. Do not remove or replay events manually.

QA acceptance (synthetic data in an isolated environment):
1. Start a paid order, refresh, and confirm Making.
2. Open a second screen, mark Ready, refresh the first, and confirm Ready.
3. Recall/Reopen, verify version increments and one event per action.
4. Submit from a stale screen; confirm rejection and refresh.
5. Lose a response, retry the original operation; verify no duplicate event.
6. Cancel the order; confirm cancellation notice and blocked transitions.
7. Verify accounting, stock and daily-close rows remain unchanged.
8. Disconnect the network; verify stale warning and disabled controls.
9. Select an earlier date; verify only that date's orders appear.

Validation: 213 local tests and 11 isolated Google Sheets runtime checks passed.
Browser fixtures verified reload persistence and two-screen synchronization.
Production inspection uses read-only requests, not synthetic sales.
