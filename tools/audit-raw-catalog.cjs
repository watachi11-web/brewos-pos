// Offline only. Audits typed, unrounded rows exported from the seven named tables.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const TABLES = ['products', 'ingredients', 'recipe_ingredients', 'sub_recipes', 'modifier_groups', 'modifier_options', 'product_modifier_groups'];
const str = x => String(x ?? '').trim();
const on = x => x === true || str(x).toUpperCase() === 'TRUE';
const ready = x => ['READY', 'READY_MODIFIER'].includes(str(x));
function convert(q, from, to) {
  if (from === to) return q;
  const scales = {'kg:g': 1000, 'g:kg': .001, 'l:ml': 1000, 'ml:l': .001};
  return Object.hasOwn(scales, from + ':' + to) ? q * scales[from + ':' + to] : null;
}
function auditRaw(tables) {
  for (const name of TABLES) if (!Array.isArray(tables[name])) throw Error('MISSING_TABLE_' + name);
  const issues = [], plans = [], subrecipes = [], add = (code, table, rows, detail = {}) => issues.push({code, table, rows: rows.map(r => r._row ?? null), ...detail});
  function index(name, key) {
    const out = new Map();
    for (const r of tables[name]) {
      const id = str(r[key]);
      if (!id || out.has(id)) add('DUPLICATE_OR_EMPTY_ID', name, [out.get(id), r].filter(Boolean), {id});
      else out.set(id, r);
    }
    return out;
  }
  const products = index('products', 'product_id'), ingredients = index('ingredients', 'ingredient_id');
  const groups = index('modifier_groups', 'group_id'), options = index('modifier_options', 'option_id');
  const links = new Set();
  for (const r of tables.recipe_ingredients) if (!products.has(str(r.product_id))) add('ORPHAN_RECIPE', 'recipe_ingredients', [r], {product_id:r.product_id});
  for (const table of ['recipe_ingredients', 'sub_recipes']) {
    const seen = new Map();
    for (const r of tables[table]) {
      if (!str(r.ingredient_id)) continue; // Adapter validates that this really is a subtotal.
      const key = JSON.stringify([str(r.product_id), str(r.ingredient_id)]);
      if (seen.has(key)) add(table === 'sub_recipes' ? 'REPEATED_SUB_COMPONENT_REVIEW' : 'REPEATED_COMPONENT_REVIEW', table, [seen.get(key), r], {product_id:r.product_id, ingredient_id:r.ingredient_id, names:[seen.get(key).ingredient_name,r.ingredient_name]});
      else seen.set(key,r);
    }
  }
  for (const r of options.values()) {
    const g = groups.get(str(r.group_id));
    if (!g) add('OPTION_WITHOUT_GROUP', 'modifier_options', [r], {option_id:r.option_id});
    else if (on(r.is_active) && !on(g.is_active)) add('ACTIVE_OPTION_IN_INACTIVE_GROUP', 'modifier_options', [r], {option_id:r.option_id});
  }
  for (const r of tables.product_modifier_groups) {
    const key = JSON.stringify([str(r.product_id),str(r.group_id)]), g = groups.get(str(r.group_id));
    if (links.has(key)) add('DUPLICATE_MODIFIER_LINK', 'product_modifier_groups', [r]);
    links.add(key);
    if (!products.has(str(r.product_id)) || !g) add('ORPHAN_MODIFIER_LINK', 'product_modifier_groups', [r]);
    if (!on(r.is_active) || !g) continue;
    const choices = [...options.values()].filter(o => str(o.group_id) === str(r.group_id) && on(o.is_active));
    const min = Number(r.min_select), max = Number(r.max_select);
    if (!on(g.is_active) || str(r.min_select)==='' || str(r.max_select)==='' || !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min || max > choices.length || (on(r.required) && min < 1)) add('INVALID_MODIFIER_SELECTION', 'product_modifier_groups', [r]);
    if (str(g.selection_type) !== 'single' || max !== 1) add('MODIFIER_COMBINATIONS_NOT_COVERED', 'product_modifier_groups', [r]);
    if (choices.filter(o=>on(o.is_default)).length > max) add('TOO_MANY_DEFAULTS', 'product_modifier_groups', [r]);
  }
  // Read-only facade: no Sheet write methods, credentials, network or sale route.
  const book = {getSheetByName(name) {
    if (!tables[name]) return null;
    const headers = [...new Set(tables[name].flatMap(r=>Object.keys(r)))].filter(k=>k!=='_row');
    return {getDataRange:()=>({getValues:()=>[headers,...tables[name].map(r=>headers.map(h=>r[h]??''))]})};
  }};
  const ctx = vm.createContext({convertInventoryQty_:convert,isBomReadyStatus_:ready});
  for (const name of ['recipe-stock-plan.js','recipe-stock-adapter.gs']) vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend',name),'utf8'),ctx);
  let context;
  try { context=ctx.brewRecipeSnapshot_(book); }
  catch(e) { add('RAW_SNAPSHOT_REJECTED','raw',[],{error:e.message}); }
  if (context) {
    for (const sub of context.snapshot.subrecipes) {
      try {
        const p=ctx.BrewRecipeStockPlan.build(context.snapshot,[{ingredient_id:sub.product_id,qty:Number(sub.yield_qty),unit:sub.yield_unit}]);
        subrecipes.push({id:sub.product_id,yield_qty:Number(sub.yield_qty),yield_unit:sub.yield_unit,...p});
      } catch(e) {add('SUBRECIPE_REJECTED','sub_recipes',tables.sub_recipes.filter(r=>str(r.product_id)===sub.product_id),{id:sub.product_id,error:e.message});}
    }
    const plan=(p,option)=>{
      try {
        const result=ctx.brewRecipePlanItems_(context,[{id:p.product_id,qty:1,_resolved_modifiers:option?[option]:[]}]);
        plans.push({product_id:p.product_id,option_id:option?.option_id??null,kind:option?'base_plus_one_option':'base_only',...result.stock});
      } catch(e) {add('PRODUCT_PLAN_REJECTED','recipe_ingredients',tables.recipe_ingredients.filter(r=>str(r.product_id)===str(p.product_id)),{product_id:p.product_id,option_id:option?.option_id??null,error:e.message});}
    };
    for (const p of products.values()) {
      if (!ready(p.bom_status) || !on(p.is_available)) continue;
      plan(p);
      for (const link of tables.product_modifier_groups.filter(r=>str(r.product_id)===str(p.product_id)&&on(r.is_active))) {
        if (!on(groups.get(str(link.group_id))?.is_active)) continue;
        for (const option of options.values()) if (str(option.group_id)===str(link.group_id)&&on(option.is_active)) plan(p,option);
      }
    }
    // Validate every active option even if not currently linked to a sellable product.
    for (const option of options.values()) if (on(option.is_active)) {
      try {ctx.BrewRecipeStockPlan.build(context.snapshot,[context.requirement(option,option.qty_used)]);}
      catch(e) {add('MODIFIER_COMPONENT_REJECTED','modifier_options',[option],{option_id:option.option_id,error:e.message});}
    }
  }
  return {counts:Object.fromEntries(TABLES.map(t=>[t,tables[t].length])),issues,subrecipes,plans,
    legacy_pseudo_ids:[...ingredients.keys()].filter(id=>/^SUB-/.test(id)),
    limitations:['Sequential typed exports are not a locked snapshot; spreadsheet query type inference may omit mixed-type cells. Preserve source exports and schema evidence.',
      'Use unformatted numeric cell values, not CSV/display values rounded to currency precision.',
      'Compatible conversion is limited to exact units and kg/g or l/ml. No density, piece weight or oz conversion is inferred.',
      'Plans model theoretical raw consumption, not an executed sale, stocktake, preparation yield measurement or browser test.',
      'Each option is checked separately with base BOM; cross-group option combinations are not enumerated.',
      'Repeated subrecipe ingredients may belong to separate preparation steps. Review rows; never merge/delete automatically.']};
}
if (require.main===module) {
  const [input,output]=process.argv.slice(2);
  if(!input||!output)throw Error('Usage: node tools/audit-raw-catalog.cjs TYPED_TABLES_JSON OUTPUT_JSON');
  const bytes=fs.readFileSync(input),result=auditRaw(JSON.parse(bytes));
  fs.writeFileSync(output,JSON.stringify({generated_at:new Date().toISOString(),source_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),...result},null,2));
  console.log(JSON.stringify({counts:result.counts,issues:result.issues.length,plans:result.plans.length,subrecipes:result.subrecipes.length}));
}
module.exports={auditRaw,convert};
