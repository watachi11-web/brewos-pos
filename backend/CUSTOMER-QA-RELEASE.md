# Customer linking and display safety — 6.2.6

POS accepts canonical `full_name` (with legacy `name` fallback), keeps the selected
customer ID, and clears the selection when the operator changes the name. The
backend verifies the ID, active/deleted flags and brand against the customer
master, then saves the canonical ID/name in every order row within the existing
atomic sale batch. It does not change points, lifetime spend or old orders.

Customer identity is included in new member-sale fingerprints. Requests without
an ID retain their old canonical representation, preserving pending-sale recovery.
Publish the backend before the frontend; POS checks the customer-linking capability.

CRM, desktop POS and kitchen display customer/menu/order text as escaped text;
data-dependent controls use event listeners rather than inline JavaScript.
The obsolete demo/password login is replaced with links to Dashboard and POS.
Single-owner access remains unchanged; this release does not add authentication,
authorization, a loyalty ledger or durable kitchen workflow.

Validation: 207 local checks passed including private generated-backend tests;
41 isolated Google Sheets checks passed for release
`b4d86184de181802542a6639fc14f8ce600b2b0ccd32234a9bf6265cb0851244`.
Local browser fixtures verified quoted/markup names in POS and CRM. No synthetic
transaction was submitted to production. Generated full Apps Script, backups and
runtime evidence remain private.
