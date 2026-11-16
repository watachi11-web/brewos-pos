# Catalog / BOM audit candidate — 2026-11-16

Status: **Conditional Acceptance; not merged or deployed**. This review does not change the historical Kitchen acceptance recorded in issue #16.

## Reproduced problems and changes

| Problem | Reproduction / regression | Change |
|---|---|---|
| Recipe follows the previously selected menu into an empty menu | `tests/recipe-editor.test.cjs`: switch menu with BOM to menu without BOM | Reset form on every menu change |
| Quantity survives while its unit is silently replaced | Open 0.5 kg flour with g stock unit; saving used to send 0.5 g | Preserve source unit; reset quantity when changing ingredient; show ID and unit |
| Partial or duplicate lines silently overwrite a complete recipe | One valid row plus incomplete, unknown, nonfinite or repeated row | Reject whole save in UI and server before writes |
| Inactive draft menus cannot be selected for recipe repair | Editor used the sellable menu endpoint | Load product master; exclude deleted products |
| Catalog cost and stock expansion disagree | Synthetic 0.5 kg flour at 0.1/g + 0.1 l water at 0.01/ml: 51, previously 0.051 | Use stock planner and unit conversion for base catalog cost and recipe display |
| Broken subrecipes can be displayed as complete/free | Missing component, unit mismatch and subrecipe cycle | Preserve error and null cost; incomplete result stays nonauthoritative |
| Recipe replacement can partially delete BOM before failing | Legacy per-row deletes/appends followed by best-effort REVIEW marker | Validate first, then one Sheets batch for replacement plus REVIEW; existing lock wrapper retained |
| Data audit cannot be reproduced consistently | Duplicates and orphan checks | `tools/audit-catalog.cjs` runs against local GET exports only; does not mutate or merge IDs |

## Validation and limits

- Local full suite: **253 passed, 0 failed, 0 skipped**, Node 24.21.0, including private reviewed-baseline sale/refund integration and the latest main menu-insights tests.
- Built private candidate: catalog tests **10 passed, 0 failed, 0 skipped**, confirming builder routing, not only standalone modules.
- Pre-change editor reproduction: 5 failures / 1 pass (six initial cases); catalog baseline reproduction: 7 failures / 3 passes. These are synthetic fault demonstrations, not live data failures.
- PR workflow runs the six portable catalog/stock test files on Ubuntu; it has read-only repository permissions and no deployment step, credentials or live endpoints in its tests.
- The code candidate has not changed live fixtures, recipes or deployed code. Separately, the owner-authorized rename of two product master names was completed and read back; no other master fields were changed. Private backend baseline and API exports are excluded from Git.
- Atomic behavior is verified with a Sheets batch simulator, not a newly created live Sheet. A runtime check on an approved isolated Sheet and browser review of the paired frontend/backend remain release gates.
- Recipe master editing changes BOM status to REVIEW; it does not approve a new recipe, merge ingredients, repair opening stock or rewrite historical order COGS.
- Catalog prices are **base BOM costs**. Selected modifier consumption still uses the server sale planner. Public menu exports omit modifier ingredient quantities; a subsequent read-only typed source-table export now covers those mappings.
- Source API exports are sequential reads and historically replace raw BOM units with inventory units. They cannot establish raw-unit consistency, nested yields, or true preparation portions. The follow-up raw audit checks typed source recipe/subrecipe/modifier tables. Physical portions, yields, and ambiguous business mappings remain unverified.
- The frontend and generated backend must be validated together in a future approved isolated environment. Existing staging identity hashes are deliberately unchanged; do not deploy this candidate into existing staging or production.

## Reproduce

```sh
node --test tests/raw-catalog-audit.test.cjs tests/catalog-audit.test.cjs tests/recipe-catalog.test.cjs tests/recipe-editor.test.cjs tests/recipe-stock-plan.test.cjs tests/recipe-stock-adapter.test.cjs
node tools/audit-catalog.cjs /path/to/private-api-exports /path/to/private-audit.json
```

Exports expected: `get_products.json`, `get_menu_data.json`, `get_recipes.json`, `get_ingredients.json`, each with `{success:true,data:...}`. Use only GET exports. Keep these files and the owner-specific mapping/report private.

For the full local integration suite, set `BREWOS_RECIPE_BASELINE` and `BREWOS_BASELINE` to the previously reviewed private source files before running `node --test tests/*.test.cjs`. The build checks the exact baseline hash and does not deploy.

## Raw-table audit follow-up

`tools/audit-raw-catalog.cjs` accepts seven arrays of typed source rows: `products`, `ingredients`, `recipe_ingredients`, `sub_recipes`, `modifier_groups`, `modifier_options`, `product_modifier_groups`. An optional `_row` records the original sheet row. Use unrounded numeric cell values; a formatted CSV can round unit costs or add thousands separators. Retain the original exports and compare them for query type-inference omissions before interpreting the result.

```sh
node tools/audit-raw-catalog.cjs /path/to/private-typed-tables.json /path/to/private-raw-audit.json
```

The auditor invokes the same stock adapter/planner through a read-only local Sheet facade, checks nested yields/references/cycles, validates active option components and product/group links, and emits base plans plus each individual option. It distinguishes legitimate human subtotal rows from malformed components and keeps repeated preparation-step quantities while flagging their source rows for review. It never infers mass/volume, ounce or piece-weight conversions, changes raw tables, runs sales, or accesses the network. Only exact units and kg/g or l/ml conversions are supported by the offline harness; unsupported aliases need review.

Nine new synthetic regressions cover full-precision cost, raw expansion once, repeated preparation steps, cycles, bad yields/units/references, subtotal corruption, missing tables, modifier linkage/default constraints, and prohibited implicit unit conversions. Cross-group combinations and actual portions require separate verification. A structurally valid graph is not Final Acceptance.
