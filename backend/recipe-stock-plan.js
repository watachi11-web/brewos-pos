/* Staged, pure planner. Not connected to a production route.
 * Inputs are normalized, server-owned recipe/ingredient snapshots, NOT request
 * data. This models theoretical raw consumption at sale, not production batches.
 * Never enable alongside manual batch deductions or prepared-stock consumption.
 */
var BrewRecipeStockPlan = (function () {
  'use strict';
  function fail(code, id) {
    var e = new Error(code + (id ? ': ' + id : ''));
    e.code = code;
    throw e;
  }
  function text(value) { return String(value == null ? '' : value).trim(); }
  function number(value, code, positive) {
    if ((typeof value !== 'number' && typeof value !== 'string') || text(value) === '') fail(code);
    var n = Number(value);
    if (!Number.isFinite(n) || (positive ? n <= 0 : n < 0)) fail(code);
    return n;
  }
  function finite(n) {
    if (!Number.isFinite(n)) fail('QUANTITY_OR_COST_OVERFLOW');
    return n;
  }
  function index(rows, key) {
    var result = new Map();
    rows.forEach(function (row) {
      if (!row || typeof row !== 'object') fail('INVALID_ROW');
      var id = text(row[key]);
      if (!id || result.has(id)) fail('DUPLICATE_OR_MISSING_ID', id);
      result.set(id, row);
    });
    return result;
  }
  function build(snapshot, requirements) {
    if (!snapshot || !Array.isArray(snapshot.ingredients) || !Array.isArray(snapshot.subrecipes) || !Array.isArray(requirements)) fail('INCOMPLETE_SNAPSHOT');
    if (snapshot.consumption_mode !== 'raw_at_sale' || snapshot.cutover_confirmed !== true) fail('CONSUMPTION_POLICY_NOT_CONFIRMED');
    var ingredients = index(snapshot.ingredients, 'ingredient_id');
    var subs = index(snapshot.subrecipes, 'product_id');
    subs.forEach(function (_, id) {
      // Legacy pseudo ingredients must be removed from the adapter snapshot.
      if (ingredients.has(id)) fail('AMBIGUOUS_STOCK_SOURCE', id);
    });
    var totals = new Map();
    function expand(line, factor, path) {
      if (!line || typeof line !== 'object') fail('INVALID_REQUIREMENT');
      var id = text(line.ingredient_id), unit = text(line.unit);
      if (!id || !unit) fail('MISSING_ID_OR_UNIT', id);
      var qty = finite(number(line.qty, 'INVALID_QUANTITY', true) * factor);
      if (!(qty > 0)) fail('QUANTITY_UNDERFLOW', id);
      if (subs.has(id)) {
        if (path.indexOf(id) !== -1) fail('SUBRECIPE_CYCLE', path.concat([id]).join(' -> '));
        if (path.length >= 32) fail('SUBRECIPE_DEPTH_LIMIT', id);
        var def = subs.get(id);
        if (def.validation_error) fail('INVALID_SUBRECIPE', id+' '+def.validation_error);
        if (text(def.yield_unit) !== unit) fail('UNIT_MISMATCH', id);
        var yieldQty = number(def.yield_qty, 'INVALID_BATCH_YIELD', true);
        if (!Array.isArray(def.lines) || !def.lines.length) fail('EMPTY_SUBRECIPE', id);
        def.lines.forEach(function (child) { expand(child, finite(qty / yieldQty), path.concat([id])); });
        return;
      }
      if (!ingredients.has(id)) fail('MISSING_INGREDIENT_OR_SUBRECIPE', id);
      var ing = ingredients.get(id);
      if (/^SUB-/.test(id)) fail('LEGACY_PSEUDO_STOCK', id);
      if (text(ing.unit) !== unit) fail('UNIT_MISMATCH', id);
      var cost = number(ing.unit_cost, 'INVALID_UNIT_COST', false);
      // Preserve the existing warn-on-shortage sales policy. Never clamp or
      // fabricate a balance; a negative opening balance remains negative.
      if((typeof ing.current_stock!=='number'&&typeof ing.current_stock!=='string')||text(ing.current_stock)===''||!Number.isFinite(Number(ing.current_stock)))fail('INVALID_CURRENT_STOCK');
      var stock = Number(ing.current_stock);
      var total = totals.get(id);
      if (!total) {
        total = {ingredient_id:id, unit:unit, quantity:0, unit_cost:cost, stock_before:stock, paths:[]};
        totals.set(id, total);
      }
      total.quantity = finite(total.quantity + qty);
      total.paths.push(path.concat([id]));
    }
    requirements.forEach(function (line) { expand(line, 1, []); });
    var moves = Array.from(totals.values()).sort(function (a, b) { return a.ingredient_id < b.ingredient_id ? -1 : 1; });
    var totalCost = 0;
    moves.forEach(function (move) {
      move.stock_after = finite(move.stock_before - move.quantity);
      move.shortage = Math.max(0, -move.stock_after);
      move.transaction_value = finite(move.quantity * move.unit_cost);
      totalCost = finite(totalCost + move.transaction_value);
    });
    return {mode:'raw_at_sale', theoretical:true, stock_moves:moves, total_cost:totalCost,
      requires_atomic_commit:true, has_shortages:moves.some(function (m) { return m.shortage > 0; })};
  }
  return {build:build};
}());
if (typeof module !== 'undefined' && module.exports) module.exports = BrewRecipeStockPlan;
