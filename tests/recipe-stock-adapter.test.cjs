const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const data={ingredients:[['ingredient_id','unit','current_stock','unit_cost'],['RAW','g',1000,0.1],['SUB-001','g',999,999]],
  sub_recipes:[['product_id','ingredient_id','qty_used','unit','batch_yield_qty','batch_yield_unit'],['SUB-001','RAW',0.5,'kg',400,'g'],['รวม SUB-001','','','',400,'g']],
  products:[['product_id','bom_status'],['PRD-001','READY']],
  recipe_ingredients:[['product_id','ingredient_id','qty_used','unit'],['PRD-001','SUB-001',80,'g']]};
 const book={getSheetByName(name){return data[name]?{getDataRange:()=>({getValues:()=>JSON.parse(JSON.stringify(data[name]))})}:null;}};
 const ctx=vm.createContext({console,isFinite,Number,Map,Set,isBomReadyStatus_:s=>['READY','READY_MODIFIER'].includes(s),
  convertInventoryQty_:(q,a,b)=>a===b?q:a==='kg'&&b==='g'?q*1000:null});
 for(const file of ['recipe-stock-plan.js','recipe-stock-adapter.gs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend',file),'utf8'),ctx);
 return {data,book,ctx,snapshot:()=>ctx.brewRecipeSnapshot_(book),plan:(items=[{id:'PRD-001',qty:1,_resolved_modifiers:[]}])=>ctx.brewRecipePlanItems_(ctx.brewRecipeSnapshot_(book),items)};
}
test('adapter excludes legacy pseudo stock and recognized subtotal rows, converts compatible units',()=>{
 const h=fixture(),c=h.snapshot();assert.equal(c.snapshot.ingredients.length,1);assert.equal(c.snapshot.subrecipes[0].lines[0].qty,500);
 const p=h.plan();assert.equal(p.stock.stock_moves[0].quantity,100);assert.equal(p.items[0].cost_per_item,10);
});
test('selected server modifiers contribute to per-item cost and aggregate stock once',()=>{
 const h=fixture(),p=h.plan([{id:'PRD-001',qty:2,_resolved_modifiers:[{ingredient_id:'SUB-001',qty_used:40,unit:'g'}]}]);
 assert.equal(p.items[0].cost_per_item,15);assert.equal(p.stock.stock_moves[0].quantity,300);
});
test('missing and ambiguous schemas are rejected instead of empty data',()=>{
 const h=fixture();delete h.data.sub_recipes;assert.throws(h.snapshot,/RECIPE_SCHEMA_MISSING/);
 const d=fixture();d.data.ingredients[0].push('unit');assert.throws(d.snapshot,/RECIPE_SCHEMA_INVALID/);
});
test('subtotal-shaped rows with an ingredient are not silently ignored',()=>{
 const h=fixture();h.data.sub_recipes[2][1]='RAW';assert.throws(h.snapshot,/INVALID_SUBRECIPE_ID/);
});
test('conflicting yields, unknown ingredients and mass-volume mixing are rejected',()=>{
 const a=fixture();a.data.sub_recipes.push(['SUB-001','RAW',1,'g',500,'g']);assert.throws(a.snapshot,/INCONSISTENT_BATCH_YIELD/);
 const b=fixture();b.data.sub_recipes[1][1]='UNKNOWN';assert.throws(b.plan,/MISSING_RECIPE_UNIT_OR_INGREDIENT/);
 const c=fixture();c.data.sub_recipes[1][3]='ml';assert.throws(c.plan,/RECIPE_UNIT_MISMATCH/);
});
test('unreviewed BOM, unresolved modifiers and duplicate product identities cannot plan a sale',()=>{
 const h=fixture();h.data.products[1][1]='REVIEW';assert.throws(h.plan,/BOM_NOT_READY/);
 const m=fixture();assert.throws(()=>m.plan([{id:'PRD-001',qty:1}]),/SERVER_MODIFIERS_NOT_RESOLVED/);
 const d=fixture();d.data.products.push(['PRD-001','READY']);assert.throws(d.plan,/DUPLICATE_PRODUCT_ID/);
});
test('invalid raw quantities and non-integer sale quantities fail before writes',()=>{
 for(const q of ['',null,0,-1,true,Infinity]){const h=fixture();h.data.sub_recipes[1][2]=q;assert.throws(h.plan,/INVALID_RECIPE_QUANTITY/);}
 const h=fixture();assert.throws(()=>h.plan([{id:'PRD-001',qty:1.5,_resolved_modifiers:[]}]),/INVALID_ORDER_QUANTITY/);
});
test('an incomplete new subrecipe blocks its own sales but not unrelated ready menus',()=>{
 const h=fixture();h.data.sub_recipes.push(['SUB-007','ING-M01',1000,'g',2000,'g']);
 assert.equal(h.plan().items[0].cost_per_item,10);
 h.data.recipe_ingredients[1][1]='SUB-007';assert.throws(h.plan,/INVALID_SUBRECIPE: SUB-007 MISSING_RECIPE_UNIT_OR_INGREDIENT_ING-M01/);
});
test('snapshot and calculation never invoke spreadsheet write methods',()=>{
 const h=fixture(),before=JSON.stringify(h.data);h.plan();assert.equal(JSON.stringify(h.data),before);
});
