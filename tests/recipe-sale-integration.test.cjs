const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {build}=require('../backend/build-recipe-sale-release.cjs'),{columns}=require('../backend/sale-batch');
const baseline=process.env.BREWOS_RECIPE_BASELINE||path.resolve(__dirname,'../../../outputs/BrewOS-refund-release.gs');
const source=fs.existsSync(baseline)?build(fs.readFileSync(baseline,'utf8')):'';
const integration=source?test:(name,fn)=>test(name,{skip:'Private reviewed baseline required'},fn);
function setup(){
 const data={
  orders:[columns.orders],order_lines:[columns.order_lines],order_line_modifiers:[columns.order_line_modifiers],sale_operations:[columns.sale_operations],
  refund_operations:[['operation_id','order_id','business_date','status','request_json','plan_json','result_json','created_at']],
  ingredients:[['ingredient_id','unit','current_stock','unit_cost'],['ING-001','g',1000,0.1],['PKG-001','pcs',100,2]],
  inventory_transactions:[['txn_id','ingredient_id','brand_id','txn_type','quantity_change','unit_type','qty_before','qty_after','reference_id','notes','performed_by','created_at','unit_cost_before','unit_cost_after','unit_price','transaction_value','supplier_id','source_doc_type','source_doc_id','shortage_qty']],
  products:[['product_id','name','brand_id','is_available','is_deleted','bom_status','cost_price'],['PRD-001','Food','HH',true,false,'READY',12],['PRD-002','Coffee','BB',true,false,'READY',8]],
  recipe_ingredients:[['product_id','ingredient_id','qty_used','unit'],['PRD-001','SUB-001',100,'g'],['PRD-001','PKG-001',1,'pcs'],['PRD-002','ING-001',20,'g'],['PRD-002','PKG-001',1,'pcs']],
  sub_recipes:[['product_id','ingredient_id','qty_used','unit','batch_yield_qty','batch_yield_unit'],['SUB-001','ING-001',500,'g',400,'g']],
  daily_closes:[['close_id','date','status']],modifier_groups:[['group_id']],modifier_options:[['option_id']],product_modifier_groups:[['product_id']],integrity_events:[['event_id']]
 };
 const ids=Object.fromEntries(Object.keys(data).map((n,i)=>[n,i+1])),props=new Map();let held=false,commits=0,mode='',uuid=0;
 const book={getSheetByName(n){if(!data[n])return null;return {getSheetId:()=>ids[n],getDataRange:()=>({getValues:()=>structuredClone(data[n])}),appendRow(){throw Error('NON_ATOMIC_WRITE_'+n);}};}};
 const ctx=vm.createContext({console,Logger:{log(){}},SpreadsheetApp:{openById:()=>book,flush(){}},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},
  LockService:{getScriptLock:()=>({tryLock(){if(held)return false;held=true;return true;},releaseLock(){assert(held);held=false;}})},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>Array.from(crypto.createHash('sha256').update(s).digest()),getUuid:()=>String(++uuid).padStart(32,'0'),formatDate:(d,_tz,format)=>format==='yyyy-MM-dd'?'2026-10-28':format==='yyyyMMdd-HHmmss'?'20261028-090000':'2026-10-28T09:00:00'},
  Sheets:{Spreadsheets:{Values:{get(_id,range){const n=range.split("'")[1];return {values:structuredClone(data[n])};}},batchUpdate(body){
   assert(held);commits++;if(mode==='reject')throw Error('atomic reject');
   const draft=structuredClone(data);
   for(const req of body.requests){const a=req.appendCells||req.updateCells,sid=a.sheetId??a.start.sheetId,n=Object.keys(ids).find(k=>ids[k]===sid);
    const values=r=>r.values.map(c=>c.userEnteredValue.numberValue??c.userEnteredValue.stringValue);
    if(req.appendCells)a.rows.forEach(r=>draft[n].push(values(r)));
    else draft[n][a.start.rowIndex][a.start.columnIndex]=values(a.rows[0])[0];
   }
   Object.assign(data,draft);if(mode==='lost')throw Error('lost response');return {};
  }}}
 });
 vm.runInContext(source,ctx);
 const run=s=>vm.runInContext(s,ctx);
 run('logIntegrityEvent_=function(){};');
 props.set('BREWOS_SALE_ENABLED_'+run('CONFIG.SPREADSHEET_ID'),'raw-at-sale-v1');
 const body={sale_client_version:'atomic-v1',customer_name:'Test',items:[{id:'PRD-001',name:'Food',qty:2,price:30}],grand:60,receipt_id:'RCP-TEST-123',datetime:'2026-10-28T09:00:00+07:00',payment_method:'qr'};
 return {data,props,ctx,body,run,submit:()=>run('submitOrderDirect('+JSON.stringify(body)+')'),setMode:m=>mode=m,counts:()=>({held,commits})};
}
integration('actual generated submit path atomically records order, lines, expanded stock and journal',()=>{
 const h=setup(),r=h.submit();assert.equal(r.success,true,JSON.stringify(r));assert.equal(h.counts().commits,1);assert.equal(h.data.orders.length,2);assert.equal(h.data.order_lines[1][8],14.5);
 assert.equal(h.data.ingredients[1][2],750);assert.equal(h.data.ingredients[2][2],98);assert.equal(h.data.inventory_transactions.length,3);assert.equal(h.data.sale_operations.length,2);assert.equal(h.counts().held,false);
});
integration('sale append does not overwrite trailing computed columns',()=>{
 const h=setup();h.data.order_lines[0].push('Net Profit','Order Date','Year','Month');assert(h.submit().success);
 assert.equal(h.data.order_lines[1].length,11);
});
integration('same request returns original result after recipes and prices change; no double stock movement',()=>{
 const h=setup();assert(h.submit().success);h.data.recipe_ingredients[1][2]=999;
 const r=h.submit();assert.equal(r.idempotent,true);assert.equal(h.counts().commits,1);assert.equal(h.data.ingredients[1][2],750);
 h.body.items[0].id='PRD-002';assert.equal(h.submit().code,'ORDER_ID_COLLISION');assert.equal(h.counts().commits,1);
});
integration('read-only status verifies the exact request and never clears a pending fence',()=>{
 const h=setup();assert.equal(h.run('brewSaleStatus_('+JSON.stringify(h.body)+')').success,false);
 h.setMode('lost');assert.equal(h.submit().code,'SALE_RESULT_UNKNOWN');const before=JSON.stringify(h.data);
 const status=h.run('brewSaleStatus_('+JSON.stringify(h.body)+')');assert.equal(status.verified,true);assert.equal(status.order_id,h.body.receipt_id);
 assert.equal(JSON.stringify(h.data),before);assert(Array.from(h.props.keys()).some(k=>k.startsWith('BREWOS_SALE_FENCE_')));
 h.body.grand=61;assert.equal(h.run('brewSaleStatus_('+JSON.stringify(h.body)+')').code,'ORDER_ID_COLLISION');
});
integration('mixed-brand discount allocation and aggregate ingredient ledger are preserved',()=>{
 const h=setup();h.body.items.push({id:'PRD-002',name:'Coffee',qty:1,price:40});h.body.discount={type:'amt',value:10};h.body.grand=90;
 const r=h.submit();assert.equal(r.success,true,JSON.stringify(r));assert.equal(r.grand,90);assert.equal(h.data.orders.length,3);assert.equal(h.data.orders[1][12]+h.data.orders[2][12],90);assert.equal(h.data.ingredients[1][2],730);assert.equal(h.data.inventory_transactions.length,3);
});
integration('bad recipe and invalid opening stock fail before any order or reservation',()=>{
 for(const mutation of [h=>h.data.ingredients[1][2]='',h=>h.data.recipe_ingredients[1][1]='UNKNOWN',h=>h.data.products[1][5]='REVIEW']){
  const h=setup();mutation(h);assert.equal(h.submit().success,false);assert.equal(h.data.orders.length,1);assert.equal(h.counts().commits,0);assert(!Array.from(h.props.keys()).some(k=>k.startsWith('BREWOS_SALE_FENCE_')));
 }
});
integration('atomic rejection leaves business tables unchanged and fences subsequent sales/stock writes',()=>{
 const h=setup();h.setMode('reject');const before=JSON.stringify(h.data);assert.equal(h.submit().code,'SALE_RESULT_UNKNOWN');assert.equal(JSON.stringify(h.data),before);
 h.setMode('');assert.equal(h.submit().code,'SALE_RECONCILIATION_REQUIRED');assert.throws(()=>h.run("adjustStock({ingredient_id:'ING-001',adjust_type:'set',amount:0})"),/SALE_RECONCILIATION_REQUIRED/);assert.equal(h.counts().commits,1);
});
integration('lost response after committed batch resolves by journal without resubmitting writes',()=>{
 const h=setup();h.setMode('lost');assert.equal(h.submit().code,'SALE_RESULT_UNKNOWN');assert.equal(h.data.orders.length,2);
 h.setMode('');assert.equal(h.submit().idempotent,true);assert.equal(h.counts().commits,1);assert.equal(h.data.ingredients[1][2],750);
});
integration('closed dates and unavailable products do not create sales',()=>{
 const h=setup();h.data.daily_closes.push(['CLOSE-20261028','2026-10-28','closed']);assert.equal(h.submit().success,false);assert.equal(h.counts().commits,0);
 const p=setup();p.data.products[1][3]=false;assert.equal(p.submit().success,false);assert.equal(p.counts().commits,0);
});
integration('candidate refuses stand-alone legacy stock writes after activation',()=>{
 const h=setup();assert.throws(()=>h.run('deductStockForOrder(null,[],"RCP-X")'),/USE_ATOMIC_SALE_FLOW/);assert.throws(()=>h.run('restoreStockForOrder(null,[],"RCP-X")'),/USE_REFUND_FLOW/);
});
integration('refund uses production completed_at schema and reverses the expanded ledger',()=>{
 const h=setup();assert(h.submit().success);h.run('brewRefundTestContext_=CONFIG.SPREADSHEET_ID;');
 const r=h.run("brewRefundOrder_({order_id:'RCP-TEST-123',operation_id:'RFD-TEST-12345678',disposition:'unprepared',reason:'SYNTHETIC',refund_confirmed:true})");
 assert.equal(r.success,true,JSON.stringify(r));assert.equal(h.data.ingredients[1][2],1000);assert.equal(h.data.ingredients[2][2],100);assert.equal(h.data.orders[1][3],'cancelled');
});
test('candidate build rejects an unreviewed source',()=>{assert.throws(()=>build('changed'),/Baseline changed/);});
integration('cached legacy clients are rejected before writes after activation',()=>{
 const h=setup();delete h.body.sale_client_version;assert.equal(h.submit().code,'SALE_CLIENT_UPGRADE_REQUIRED');assert.equal(h.counts().commits,0);
 assert.equal(h.run('submitOrder()').code,'SALE_CLIENT_UPGRADE_REQUIRED');
});
