const {test}=require('node:test'),assert=require('node:assert/strict');
const Planner=require('../backend/refund-plan'),Commit=require('../backend/refund-commit'),Batch=require('../backend/refund-batch'),Report=require('../backend/refund-report');
const clone=o=>JSON.parse(JSON.stringify(o));
const request=extra=>({order_id:'ORD1',operation_id:'RFD-12345678',disposition:'unprepared',reason:'=literal reason, not a formula',refund_confirmed:true,...extra});
const operatorConfirmation='FINISH RFD-12345678 EXECUTIONS TERMINAL AND POS PAUSED';
function setup(options={}){
 const table=(sheetId,headers,rows)=>({sheetId,headers,rows:rows.map((r,i)=>({...r,_row:i+1}))});
 let tables={
  orders:table(1,['order_id','brand_id','business_date','order_status','payment_status','subtotal','discount_amount','total_amount','payment_method','notes','updated_at'],[{order_id:'ORD1',brand_id:'BB',business_date:'2026-10-08',order_status:'completed',payment_status:'paid',subtotal:60,discount_amount:0,total_amount:60,payment_method:'qr',notes:'original',updated_at:'2026-10-08T10:00:00'}]),
  ingredients:table(2,['ingredient_id','unit','current_stock','unit_cost'],[{ingredient_id:'I1',unit:'g',current_stock:80,unit_cost:0.5}]),
  transactions:table(3,['txn_id','ingredient_id','txn_type','quantity_change','unit_type','qty_before','qty_after','reference_id','notes','created_at','unit_cost_before','unit_cost_after','unit_price','transaction_value','source_doc_type','source_doc_id'],[{txn_id:'ITX1',ingredient_id:'I1',txn_type:'sale_deduction',quantity_change:-20,unit_type:'g',qty_before:100,qty_after:80,reference_id:'ORD1',source_doc_id:'ORD1',unit_price:0.5,transaction_value:10}]),
  operations:table(4,Batch.operationHeaders,[])
 };
 let locked=false,reads=0,reserves=0,commits=0,fence=null;const calls=[];
 function batch(body){
  // In-memory mock of the all-or-none contract; no Google service is contacted.
  const next=clone(tables);body.requests.forEach((r,index)=>{
   if(options.rejectAt===index)throw Error('REJECTED_BATCH');
   const a=r.appendCells||r.updateCells,t=Object.values(next).find(t=>t.sheetId===(a.sheetId??a.start?.sheetId));assert.ok(t);
   if(r.appendCells)for(const data of a.rows){const out={_row:t.rows.length+1};data.values.forEach((c,i)=>out[t.headers[i]]=c.userEnteredValue.numberValue??c.userEnteredValue.stringValue);t.rows.push(out);}
   else {assert.equal(a.fields,'userEnteredValue');const row=t.rows.find(r=>r._row===a.start.rowIndex);assert.ok(row);row[t.headers[a.start.columnIndex]]=a.rows[0].values[0].userEnteredValue.numberValue??a.rows[0].values[0].userEnteredValue.stringValue;}
  });tables=next;
 }
 const store={
  lock(){if(options.busy||locked)return false;locked=true;return true;},unlock(){locked=false;},
  readFence(){return fence;},setFence(v){fence=clone(v);},clearFence(id){assert.equal(fence.operation_id,id);fence=null;},
  readOperations(){reads++;if(options.readFailAt===reads)throw Error('READ_TIMEOUT');return clone(tables.operations.rows);},
  snapshot(){return {businessDate:'2026-10-08',dayStates:[{date:'2026-10-08',status:'open',locked:false}],orders:clone(tables.orders.rows),lines:[{line_id:'L1',order_id:'ORD1',quantity:1,cost_at_order:25}],inventoryTransactions:clone(tables.transactions.rows),ingredients:clone(tables.ingredients.rows)};},
  prepare(plan,result,fingerprint){return Batch.prepare(plan,result,fingerprint,clone(tables),'2026-10-08T11:00:00');},
  reserve(plan,fingerprint){reserves++;const p=store.prepare(plan,{success:true,operation_id:plan.operation_id,order_id:plan.order_id,order_ids:plan.order_ids,business_date:plan.business_date,disposition:plan.disposition,refund_amount:plan.refund_amount,refund_by_payment:plan.refund_by_payment,consumed_cost:plan.accounting.consumed_cost_retained,stock:plan.stock_moves,manual_refund_only:true},fingerprint);calls.push({reserve:p.intent});if(options.reserveFailBefore)throw Error('TIMEOUT');batch({requests:[p.intent]});if(options.reserveFailAfter)throw Error('TIMEOUT');},
  commit(prepared,pending){commits++;const body=Batch.commit(prepared,pending);calls.push({commit:body});if(options.commitFailBefore)throw Error('TIMEOUT');batch(body);if(options.commitFailAfter)throw Error('TIMEOUT');}
 };
 return {store,options,calls,run:extra=>Commit.execute(request(extra),store,Planner),tables:()=>tables,counts:()=>({reserves,commits,locked})};
}

test('operator recovery requires explicit quiescence confirmation and minimum quiet period',()=>{
 const h=setup({commitFailBefore:true});h.run();const started=h.store.readFence().started_at_ms;
 assert.equal(Commit.reconcile(h.store,Planner,'',started+3600000).code,'OPERATOR_CONFIRMATION_REQUIRED');
 assert.equal(Commit.reconcile(h.store,Planner,operatorConfirmation,started+1000).code,'RECOVERY_QUIET_PERIOD_REQUIRED');
 assert.equal(h.tables().orders.rows[0].order_status,'completed');assert.ok(h.store.readFence());
});
test('verified operator recovery finishes a pending intent once, preserving original ID',()=>{
 const h=setup({commitFailBefore:true});h.run();h.options.commitFailBefore=false;
 const r=Commit.reconcile(h.store,Planner,operatorConfirmation,h.store.readFence().started_at_ms+3600000);
 assert.equal(r.success,true);assert.equal(r.operator_reconciled,true);assert.equal(h.tables().ingredients.rows[0].current_stock,100);assert.equal(h.store.readFence(),null);
 assert.equal(h.run().idempotent,true);assert.equal(h.tables().ingredients.rows[0].current_stock,100);
});
test('operator recovery refuses changed stock snapshots and preserves the fence',()=>{
 const h=setup({commitFailBefore:true});h.run();h.options.commitFailBefore=false;h.tables().ingredients.rows[0].current_stock=81;
 const r=Commit.reconcile(h.store,Planner,operatorConfirmation,h.store.readFence().started_at_ms+3600000);
 assert.equal(r.code,'RECOVERY_SNAPSHOT_CHANGED');assert.ok(h.store.readFence());assert.equal(h.tables().orders.rows[0].order_status,'completed');
});
test('absent reservation can only be completed through verified operator workflow',()=>{
 const h=setup({reserveFailBefore:true});h.run();assert.equal(h.tables().operations.rows.length,0);assert.ok(h.store.readFence());
 h.options.reserveFailBefore=false;
 const r=Commit.reconcile(h.store,Planner,operatorConfirmation,h.store.readFence().started_at_ms+3600000);
 assert.equal(r.success,true);assert.equal(h.tables().operations.rows.length,1);assert.equal(h.tables().ingredients.rows[0].current_stock,100);
});
test('recovery with a lost commit response never automatically repeats business writes',()=>{
 const h=setup({commitFailBefore:true});h.run();h.options.commitFailBefore=false;h.options.commitFailAfter=true;
 const now=h.store.readFence().started_at_ms+3600000;
 assert.equal(Commit.reconcile(h.store,Planner,operatorConfirmation,now).success,false);assert.ok(h.store.readFence());
 const count=h.counts().commits;
 assert.equal(Commit.reconcile(h.store,Planner,operatorConfirmation,now).idempotent,true);assert.equal(h.counts().commits,count);
});
test('one atomic business batch commits stock, order status and journal result',()=>{
 const h=setup(),r=h.run();assert.equal(r.success,true);assert.equal(h.tables().ingredients.rows[0].current_stock,100);assert.equal(h.tables().orders.rows[0].order_status,'cancelled');
 assert.equal(h.tables().operations.rows[0].status,'committed');assert.equal(h.tables().transactions.rows.length,2);assert.equal(h.counts().commits,1);assert.equal(h.counts().locked,false);
 assert.ok(h.calls[1].commit.requests.some(r=>r.updateCells?.start.sheetId===4));
});
test('same request returns recorded success without another stock write',()=>{
 const h=setup();h.run();const before=JSON.stringify(h.tables()),r=h.run();assert.equal(r.success,true);assert.equal(r.idempotent,true);assert.equal(JSON.stringify(h.tables()),before);assert.equal(h.counts().commits,1);
});
test('changed request ID/body conflicts and different ID cannot refund same bill twice',()=>{
 const h=setup();h.run();assert.equal(h.run({reason:'changed'}).code,'OPERATION_ID_CONFLICT');assert.equal(h.run({operation_id:'RFD-87654321'}).code,'ALREADY_REFUNDED');assert.equal(h.counts().commits,1);
});
test('lost response after atomic success resolves read-only on retry',()=>{
 const h=setup({commitFailAfter:true});assert.equal(h.run().code,'REFUND_RESULT_UNKNOWN');assert.equal(h.tables().ingredients.rows[0].current_stock,100);
 const r=h.run();assert.equal(r.success,true);assert.equal(r.idempotent,true);assert.equal(h.counts().commits,1);
});
test('failure before commit leaves intent and prevents any automatic replay',()=>{
 const h=setup({commitFailBefore:true});assert.equal(h.run().do_not_retry,true);assert.equal(h.tables().ingredients.rows[0].current_stock,80);assert.equal(h.tables().orders.rows[0].order_status,'completed');
 assert.equal(h.tables().operations.rows[0].status,'pending');h.options.commitFailBefore=false;assert.equal(h.run().code,'REFUND_RECONCILIATION_REQUIRED');assert.equal(h.counts().commits,1);
});
test('lost reservation response never proceeds to business writes',()=>{
 const h=setup({reserveFailAfter:true});assert.equal(h.run().code,'REFUND_RESULT_UNKNOWN');assert.equal(h.counts().commits,0);assert.equal(h.run().code,'REFUND_RECONCILIATION_REQUIRED');
});
test('reservation timeout with no visible row still blocks retries and other refunds',()=>{
 const h=setup({reserveFailBefore:true});assert.equal(h.run().code,'REFUND_RESULT_UNKNOWN');assert.equal(h.tables().operations.rows.length,0);
 h.options.reserveFailBefore=false;assert.equal(h.run().code,'REFUND_RECONCILIATION_REQUIRED');assert.equal(h.run({operation_id:'RFD-87654321'}).code,'REFUND_RECONCILIATION_REQUIRED');assert.equal(h.counts().commits,0);assert.equal(h.counts().reserves,1);
});
test('reservation read-back failure leaves no business change',()=>{
 const h=setup({readFailAt:2});assert.equal(h.run().code,'REFUND_RESULT_UNKNOWN');assert.equal(h.counts().commits,0);assert.equal(h.tables().orders.rows[0].order_status,'completed');
});
test('commit read-back failure is unknown, then resolves without replay',()=>{
 const h=setup({readFailAt:3});assert.equal(h.run().code,'REFUND_RESULT_UNKNOWN');assert.equal(h.run().success,true);assert.equal(h.counts().commits,1);
});
test('rejection at each atomic request boundary preserves original business state',()=>{
 const baseline=setup();baseline.run();const count=baseline.calls[1].commit.requests.length;
 for(let i=0;i<count;i++){
  const h=setup();const commit=h.store.commit;h.store.commit=(...args)=>{h.options.rejectAt=i;return commit(...args);};
  const before=clone(h.tables());assert.equal(h.run().code,'REFUND_RESULT_UNKNOWN');
  assert.deepEqual(h.tables().orders,before.orders);assert.deepEqual(h.tables().ingredients,before.ingredients);assert.deepEqual(h.tables().transactions,before.transactions);assert.equal(h.tables().operations.rows[0].status,'pending');
 }
});
test('lock contention and incomplete schema cause zero reservations and writes',()=>{
 const h=setup({busy:true});assert.equal(h.run().code,'WRITE_LOCK_TIMEOUT');assert.equal(h.counts().reserves,0);
 const p=setup();p.tables().orders.headers=p.tables().orders.headers.filter(h=>h!=='payment_status');assert.equal(p.run().code,'MISSING_HEADER_payment_status');assert.equal(p.counts().reserves,0);assert.equal(p.counts().locked,false);
});
test('prepared refund has no ingredient/ledger update and safe literal strings',()=>{
 const h=setup();assert.equal(h.run({disposition:'prepared'}).success,true);
 const body=h.calls[1].commit;assert.ok(body.requests.every(r=>!r.appendCells&&![2,3].includes(r.updateCells.start.sheetId)));
 assert.equal(h.tables().ingredients.rows[0].current_stock,80);assert.equal(h.tables().transactions.rows.length,1);assert.equal(h.tables().orders.rows[0].notes,'original [refund RFD-12345678; prepared; =literal reason, not a formula]');
});
test('committed cost projection agrees across daily/month/brand and never changes cash expenses',()=>{
 const h=setup();h.run({disposition:'prepared'});const rows=h.tables().operations.rows;
 const day=Report.sum(rows,'2026-10-08','2026-10-08','ALL'),month=Report.sum(rows,'2026-10-01','2026-10-31','ALL'),bb=Report.sum(rows,'2026-10-01','2026-10-31','BB'),hh=Report.sum(rows,'2026-10-01','2026-10-31','HH');
 assert.equal(day.consumed_cost,25);assert.equal(month.consumed_cost,25);assert.equal(bb.consumed_cost,25);assert.equal(hh.consumed_cost,0);
 const activeOnly={cogs:30,gross_profit:70,net_profit:65,inventory_spend:148,total_expenses:5,expected_payment:{qr:100}};
 const out=Report.apply(activeOnly,day);assert.equal(out.cogs,55);assert.equal(out.gross_profit,45);assert.equal(out.net_profit,40);assert.equal(out.total_expenses,5);assert.deepEqual(out.expected_payment,{qr:100});assert.equal(activeOnly.cogs,30);assert.throws(()=>Report.apply(out,day),/ALREADY_APPLIED/);
});
test('reports reject unresolved and duplicated refund records',()=>{
 const h=setup({commitFailBefore:true});h.run();assert.throws(()=>Report.sum(h.tables().operations.rows,'2026-10-01','2026-10-31'),/RECONCILIATION/);
 const p=setup();p.run();const rows=p.tables().operations.rows;assert.throws(()=>Report.sum([...rows,...rows],'2026-10-01','2026-10-31'),/CONFLICT/);
});
test('unprepared refund adds no consumed cost to active-only reports',()=>{
 const h=setup();h.run();const projection=Report.sum(h.tables().operations.rows,'2026-10-01','2026-10-31');assert.equal(projection.consumed_cost,0);assert.equal(projection.refund_amount_all_brands,60);
});
test('report rejects corrupt cost and payment metadata rather than showing zero',()=>{
 for(const alter of [p=>delete p.accounting.consumed_cost_retained,p=>p.refund_by_payment.qr=1,p=>p.accounting.by_brand.BB.consumed_cost=-1,p=>p.refund_amount=61]){
  const h=setup();h.run({disposition:'prepared'});const rows=h.tables().operations.rows,p=JSON.parse(rows[0].plan_json);alter(p);rows[0].plan_json=JSON.stringify(p);assert.throws(()=>Report.sum(rows,'2026-10-01','2026-10-31'),/INVALID/);
 }
});
test('invalid journal encoding is rejected before reservation',()=>{
 const h=setup();h.tables().orders.rows[0].notes='x'.repeat(45000);assert.equal(h.run().code,'CELL_VALUE_TOO_LARGE');assert.equal(h.counts().reserves,0);
});
