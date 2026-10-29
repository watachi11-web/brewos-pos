const {test} = require('node:test');
const assert = require('node:assert/strict');
const {build} = require('../backend/recipe-stock-plan');
function fixture() {
  return {consumption_mode:'raw_at_sale',cutover_confirmed:true,
    ingredients:[
      {ingredient_id:'RAW',unit:'g',unit_cost:0.1,current_stock:3000},
      {ingredient_id:'SALT',unit:'g',unit_cost:0.01,current_stock:100},
      {ingredient_id:'BOX',unit:'pcs',unit_cost:2,current_stock:10}],
    subrecipes:[{product_id:'SUB-001',yield_qty:1000,yield_unit:'g',lines:[
      {ingredient_id:'RAW',qty:1200,unit:'g'},
      {ingredient_id:'SALT',qty:10,unit:'g'},
      {ingredient_id:'SALT',qty:5,unit:'g'}]}]};
}
const req = () => [{ingredient_id:'SUB-001',qty:100,unit:'g'},{ingredient_id:'BOX',qty:1,unit:'pcs'}];
function fails(change,code,requirements=req()) {
  const s=fixture(); change(s);
  assert.throws(()=>build(s,requirements),e=>e.code===code);
}
test('yield expansion combines repeated ingredients and preserves fractional quantities',()=>{
  const p=build(fixture(),req());
  assert.equal(p.total_cost,14.015);
  assert.equal(p.stock_moves.length,3);
  const raw=p.stock_moves.find(x=>x.ingredient_id==='RAW');
  assert.equal(raw.quantity,120); assert.equal(raw.stock_after,2880);
  assert.equal(p.stock_moves.find(x=>x.ingredient_id==='SALT').quantity,1.5);
  assert.equal(p.has_shortages,false);
});
test('nested subrecipes plus direct and modifier-equivalent requirements aggregate once',()=>{
  const s=fixture();s.subrecipes.push({product_id:'SUB-002',yield_qty:200,yield_unit:'g',lines:[{ingredient_id:'SUB-001',qty:100,unit:'g'}]});
  const p=build(s,[{ingredient_id:'SUB-002',qty:100,unit:'g'},{ingredient_id:'RAW',qty:10,unit:'g'},...req()]);
  assert.equal(p.stock_moves.find(x=>x.ingredient_id==='RAW').quantity,190);
  assert.equal(p.stock_moves.filter(x=>x.ingredient_id==='RAW').length,1);
});
test('cutover requires explicit policy, never defaults to double deduction',()=>{
  fails(s=>delete s.cutover_confirmed,'CONSUMPTION_POLICY_NOT_CONFIRMED');
  fails(s=>s.cutover_confirmed='true','CONSUMPTION_POLICY_NOT_CONFIRMED');
  fails(s=>s.consumption_mode='manual_batch','CONSUMPTION_POLICY_NOT_CONFIRMED');
});
test('missing IDs and duplicate definitions fail rather than partially deduct',()=>{
  fails(s=>s.ingredients.shift(),'MISSING_INGREDIENT_OR_SUBRECIPE');
  fails(s=>s.subrecipes=[],'MISSING_INGREDIENT_OR_SUBRECIPE');
  fails(s=>s.ingredients.push({...s.ingredients[0]}),'DUPLICATE_OR_MISSING_ID');
  fails(s=>s.subrecipes.push({...s.subrecipes[0]}),'DUPLICATE_OR_MISSING_ID');
});
test('legacy pseudo stock is never consumed or combined with a subrecipe',()=>{
  fails(s=>s.ingredients.push({ingredient_id:'SUB-001',unit:'g',current_stock:20,unit_cost:1}),'AMBIGUOUS_STOCK_SOURCE');
  fails(s=>{s.subrecipes=[];s.ingredients.push({ingredient_id:'SUB-001',unit:'g',current_stock:20,unit_cost:1});},'LEGACY_PSEUDO_STOCK');
});
test('mass, volume, pieces and batch yield units cannot be inferred',()=>{
  fails(s=>s.ingredients[0].unit='ml','UNIT_MISMATCH');
  fails(s=>s.subrecipes[0].yield_unit='ml','UNIT_MISMATCH');
  fails(()=>{},'MISSING_ID_OR_UNIT',[{ingredient_id:'RAW',qty:2}]);
});
test('cycles, empty recipes and invalid yields fail closed',()=>{
  fails(s=>s.subrecipes[0].lines.push({ingredient_id:'SUB-001',qty:1,unit:'g'}),'SUBRECIPE_CYCLE');
  fails(s=>s.subrecipes[0].lines=[],'EMPTY_SUBRECIPE');
  for(const value of [0,-1,'',null,true,Infinity]) fails(s=>s.subrecipes[0].yield_qty=value,'INVALID_BATCH_YIELD');
});
test('invalid quantities, costs and balances do not become zero',()=>{
  for(const qty of [0,-1,'',null,true,Infinity,[],{}]) fails(()=>{},'INVALID_QUANTITY',[{ingredient_id:'RAW',qty,unit:'g'}]);
  fails(s=>s.ingredients[0].unit_cost='','INVALID_UNIT_COST');
  for(const balance of ['',null,true,Infinity])fails(s=>s.ingredients[0].current_stock=balance,'INVALID_CURRENT_STOCK');
  fails(s=>s.ingredients[0].unit_cost=Number.MAX_VALUE,'QUANTITY_OR_COST_OVERFLOW');
});
test('shortages are explicit; planner does not silently clamp a balance',()=>{
  const s=fixture();s.ingredients[0].current_stock=5;
  const p=build(s,req()),m=p.stock_moves.find(x=>x.ingredient_id==='RAW');
  assert.equal(m.stock_after,-115);assert.equal(m.shortage,115);assert.equal(p.has_shortages,true);
});
test('existing negative stock remains visible and follows the legacy shortage-warning policy',()=>{
  const s=fixture();s.ingredients[0].current_stock=-3;
  const m=build(s,req()).stock_moves.find(x=>x.ingredient_id==='RAW');
  assert.equal(m.stock_before,-3);assert.equal(m.stock_after,-123);assert.equal(m.shortage,123);
});
test('deterministic, no input mutations and no rounding away small consumption',()=>{
  const s=fixture(),r=[{ingredient_id:'SUB-001',qty:0.0001,unit:'g'}],before=JSON.stringify({s,r});
  const p=build(s,r);assert.deepEqual(p,build(s,r));assert.equal(JSON.stringify({s,r}),before);
  assert(p.stock_moves.every(x=>x.quantity>0));assert.equal(p.requires_atomic_commit,true);
});
test('empty requirements have explicit zero, but incomplete snapshots fail',()=>{
  assert.equal(build(fixture(),[]).total_cost,0);
  assert.throws(()=>build({},req()),e=>e.code==='INCOMPLETE_SNAPSHOT');
});
test('expanded aggregate ledger can be refunded without reading current recipes',()=>{
  const refund=require('../backend/refund-plan');
  const s=fixture(),p=build(s,req());
  const snapshot={businessDate:'2026-10-26',dayStates:[{date:'2026-10-26',status:'open',locked:false}],operations:[],
    orders:[{order_id:'ORDER1',brand_id:'HH',business_date:'2026-10-26',order_status:'completed',payment_status:'paid',subtotal:30,discount_amount:0,total_amount:30,payment_method:'qr'}],
    lines:[{line_id:'LINE1',order_id:'ORDER1',quantity:1,cost_at_order:14.02}],
    inventoryTransactions:p.stock_moves.map((m,i)=>({txn_id:'ITX'+i,txn_type:'sale_deduction',reference_id:'ORDER1',source_doc_id:'ORDER1',ingredient_id:m.ingredient_id,unit_type:m.unit,quantity_change:-m.quantity,qty_before:m.stock_before,qty_after:m.stock_after,unit_price:m.unit_cost,transaction_value:m.transaction_value})),
    ingredients:p.stock_moves.map(m=>({ingredient_id:m.ingredient_id,unit:m.unit,current_stock:m.stock_after,unit_cost:m.unit_cost}))};
  const request={order_id:'ORDER1',operation_id:'RFD-12345678',disposition:'unprepared',reason:'Confirmed',refund_confirmed:true};
  const restored=refund.build(request,snapshot);
  for(const m of restored.stock_moves) assert.equal(m.qty_after,s.ingredients.find(x=>x.ingredient_id===m.ingredient_id).current_stock);
  assert.equal(restored.stock_moves.length,3);
  const prepared=refund.build({...request,disposition:'prepared'},snapshot);
  assert.deepEqual(prepared.stock_moves,[]);assert.equal(prepared.accounting.consumed_cost_retained,14.02);
});
