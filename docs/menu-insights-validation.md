# Menu insights — 16 November 2026

POS ranks within brand/category using completed paid order quantities in the last 30 completed Bangkok calendar days. Manual featured items are pinned ahead and labelled ร้านแนะนำ; ties preserve the original order. Ranking applies only before the first menu interaction; statistics failures preserve the original order. There is no polling, local persistence of orders, or backend mutation.

The editor shows quantities for 30/90 days, last sale within that window, and current price less current recipe cost (not historical or net profit). Partial/fully refunded orders are not reconstructed: the visible label explicitly describes paid completed orders, not net sales after returns. Unknown product IDs are excluded; historical name aliases are not guessed. A response at the API's 5,000-order cap is rejected rather than silently ranked as complete. Current menuData only supplies sale-available products, so this is not an all-time inactive-product audit.

The four proposed dishes are a visible planning panel, not sellable products or editable lifecycle records. The existing beef rice ID is referenced to prevent duplication. Prices, portion sizes, suppliers and recipes still require input. Trial/preorder/archive lifecycle support is not implemented by this change.

Validation:
- `node --test tests/*.test.cjs`: 223 passed, 0 failed, 0 skipped.
- Inline JavaScript in pos.html and brand_editor.html compiles; `git diff --check` passes.
- Chromium desktop, synthetic data only: ranking; no reorder after interaction while fetch is pending; network-failure fallback; editor 30/90 metrics and four-dish plan. No page errors and no POST requests.
- Reproduce from repository root: `BREWOS_PLAYWRIGHT=/path/to/playwright PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers node tools/menu-insights-browser.cjs` (or install Playwright in the normal runtime). Images go to `/tmp/brewos-menu-proof` by default.

No production orders, recipes, inventory, accounting, api.js or Apps Script files changed. Staging's committed pages have not been rebuilt/deployed as part of this patch. This does not claim an independent QA pass or production activation.
