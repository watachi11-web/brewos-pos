const {test}=require('node:test'),assert=require('node:assert/strict');
const {auditRaw,convert}=require('../tools/audit-raw-catalog.cjs');
function fixture(){return {
 products:[{product_id:'P',bom_status:'READY_MODIFIER',is_available:true}],
 ingredients:[{ingredient_id:'RAW',unit:'g',unit_cost:.123456,current_stock:1000},{ingredient_id:'WATER',unit:'ml',unit_cost:.01,current_stock:1000},{ingredient_id:'SUB-001',unit:'g',unit_cost:999,current_stock:999}],
 sub_recipes:[{product_id:'SUB-001',ingredient_id:'RAW',qty_used:.5,unit:'kg',batch_yield_qty:400,batch_yield_unit:'g',_row:2},{product_id:'รวม SUB-001',ingredient_id:'',qty_used:'',_row:3}],
 recipe_ingredients:[{product_id:'P',ingredient_id:'WATER',qty_used:10,unit:'ml',_row:2}],
 modifier_groups:[{group_id:'G',selection_type:'single',is_active:true}],
 modifier_options:[{option_id:'O',group_id:'G',ingredient_id:'SUB-001',qty_used:40,unit:'g',is_default:true,is_active:true,_row:2}],
 product_modifier_groups:[{product_id:'P',group_id:'G',min_select:1,max_select:1,required:true,is_active:true,_row:2}]
};}
test('typed base and selected modifier costs retain precision and expand raw once without writes',()=>{
 const f=fixture(),before=JSON.stringify(f),r=auditRaw(f);
 assert.deepEqual(r.issues,[]);assert.equal(r.plans.length,2);assert.equal(r.subrecipes.length,1);
 assert.equal(r.plans[0].total_cost,.1);assert(Math.abs(r.plans[1].total_cost-6.2728)<1e-12);
 assert.equal(r.plans[1].stock_moves.find(m=>m.ingredient_id==='RAW').quantity,50);
 assert(!r.plans[1].stock_moves.some(m=>m.ingredient_id==='SUB-001'));
 assert.equal(JSON.stringify(f),before);
});
test('repeated preparation components are reported with source rows but both are consumed',()=>{
 const f=fixture();f.sub_recipes.push({...f.sub_recipes[0],qty_used:.1,ingredient_name:'second preparation step',_row:8});
 const r=auditRaw(f);assert.deepEqual(r.issues[0].rows,[2,8]);assert.equal(r.issues[0].code,'REPEATED_SUB_COMPONENT_REVIEW');
 assert.equal(r.plans[1].stock_moves.find(m=>m.ingredient_id==='RAW').quantity,60);
});
test('cycle blocks the dependent modifier, but leaves independent base plan available',()=>{
 const f=fixture();Object.assign(f.sub_recipes[0],{ingredient_id:'SUB-001',unit:'g'});const r=auditRaw(f);
 assert.equal(r.plans.length,1);assert(r.issues.some(i=>/SUBRECIPE_CYCLE/.test(i.error)));assert(r.issues.some(i=>i.code==='MODIFIER_COMPONENT_REJECTED'));
});
test('invalid yields, mixed mass/volume and unknown references produce explicit errors',()=>{
 for(const change of [f=>f.sub_recipes[0].batch_yield_qty=0,f=>f.sub_recipes[0].unit='ml',f=>f.sub_recipes[0].ingredient_id='MISSING']){
  const f=fixture();change(f);const r=auditRaw(f);assert(r.issues.some(i=>i.code==='SUBRECIPE_REJECTED'));assert.equal(r.plans.length,1);
 }
});
test('missing tables and duplicate identities cannot masquerade as a clean audit',()=>{
 const f=fixture();delete f.modifier_options;assert.throws(()=>auditRaw(f),/MISSING_TABLE/);
 const d=fixture();d.products.push({...d.products[0]});assert(auditRaw(d).issues.some(i=>i.code==='DUPLICATE_OR_EMPTY_ID'));
});
test('orphan and duplicate modifier links, defaults and selection constraints are detected',()=>{
 const f=fixture();f.product_modifier_groups.push({...f.product_modifier_groups[0]});
 f.modifier_options.push({...f.modifier_options[0],option_id:'O2'});
 f.modifier_options.push({...f.modifier_options[0],option_id:'ORPHAN',group_id:'MISSING'});
 f.product_modifier_groups.push({product_id:'MISSING',group_id:'MISSING',is_active:true});
 f.product_modifier_groups.push({...f.product_modifier_groups[0],max_select:0});
 const codes=new Set(auditRaw(f).issues.map(i=>i.code));
 for(const c of ['DUPLICATE_MODIFIER_LINK','TOO_MANY_DEFAULTS','OPTION_WITHOUT_GROUP','ORPHAN_MODIFIER_LINK','INVALID_MODIFIER_SELECTION'])assert(codes.has(c),c);
});
test('unlinked active options are still validated, inactive options are not sale plans',()=>{
 const f=fixture();f.product_modifier_groups=[];f.modifier_options[0].ingredient_id='MISSING';assert(auditRaw(f).issues.some(i=>i.code==='MODIFIER_COMPONENT_REJECTED'));
 f.modifier_options[0].is_active=false;assert(!auditRaw(f).issues.some(i=>i.code==='MODIFIER_COMPONENT_REJECTED'));
});
test('subtotal-shaped component cannot silently disappear and conflicting yields fail visibly',()=>{
 const f=fixture();f.sub_recipes[1].ingredient_id='RAW';assert(auditRaw(f).issues.some(i=>i.code==='RAW_SNAPSHOT_REJECTED'));
 const g=fixture();g.sub_recipes.push({...g.sub_recipes[0],batch_yield_qty:500});assert(auditRaw(g).issues.some(i=>/INCONSISTENT_BATCH_YIELD/.test(i.error)));
});
test('unit conversion never invents ounce density or piece weights',()=>{
 assert.equal(convert(1,'kg','g'),1000);assert.equal(convert(1,'ml','l'),.001);
 for(const [a,b] of [['oz','g'],['oz','ml'],['g','ml'],['pcs','g']])assert.equal(convert(1,a,b),null);
});
