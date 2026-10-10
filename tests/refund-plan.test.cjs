const {test}=require('node:test'),assert=require('node:assert/strict');
const {build}=require('../backend/refund-plan');
function fixture(){return {businessDate:'2026-10-07',dayStates:[{date:'2026-10-07',status:'open',locked:false}],operations:[],
 orders:[{order_id:'ORD1',brand_id:'BB',business_date:'2026-10-07',order_status:'completed',payment_status:'paid',subtotal:70,discount_amount:10,total_amount:60,payment_method:'qr'}],
 lines:[{line_id:'ORD1-L1',order_id:'ORD1',quantity:2,cost_at_order:12.5}],
 inventoryTransactions:[{txn_id:'ITX1',txn_type:'sale_deduction',reference_id:'ORD1',source_doc_id:'ORD1',ingredient_id:'I1',unit_type:'g',quantity_change:-20,qty_before:100,qty_after:80,unit_price:0.5,transaction_value:10}],
 ingredients:[{ingredient_id:'I1',unit:'g',current_stock:200,unit_cost:1}]};}
const request=(extra={})=>({order_id:'ORD1',operation_id:'RFD-12345678',disposition:'prepared',reason:'Customer refund confirmed',refund_confirmed:true,...extra});
function fails(change,code,req={}){const s=fixture();change(s);assert.throws(()=>build(request(req),s),e=>e.code===code);}
test('prepared refund keeps consumed cost once, changes no stock and invents no expense',()=>{
 const p=build(request(),fixture());assert.equal(p.refund_amount,60);assert.deepEqual(p.refund_by_payment,{qr:60});
 assert.deepEqual(p.stock_moves,[]);assert.equal(p.accounting.sale_cogs_removed,25);assert.equal(p.accounting.consumed_cost_retained,25);
 assert.equal(p.accounting.cogs_delta,0);assert.equal(p.accounting.gross_profit_delta,-60);assert.equal(p.accounting.expense_delta,0);
});
test('unprepared cancellation restores original ledger, not current recipes or WAC',()=>{
 const s=fixture();s.recipes=[{ingredient_id:'I1',quantity:999}];s.modifiers=[{cost:999}];
 const p=build(request({disposition:'unprepared'}),s),m=p.stock_moves[0];
 assert.equal(m.quantity_change,20);assert.equal(m.qty_after,220);assert.equal(m.transaction_value,10);assert.equal(m.unit_cost_after,210/220);
 assert.equal(p.accounting.cogs_delta,-25);assert.equal(p.accounting.gross_profit_delta,-35);assert.equal(p.accounting.consumed_cost_retained,0);
});
test('mixed-brand whole bill uses shared stock ledger once and preserves brand costs',()=>{
 const s=fixture();s.orders[0].order_id='ORD1-BB';s.lines[0].order_id='ORD1-BB';
 s.orders.push({...s.orders[0],order_id:'ORD1-HH',brand_id:'HH',subtotal:40,discount_amount:0,total_amount:40});
 s.lines.push({line_id:'HH-L1',order_id:'ORD1-HH',quantity:1,cost_at_order:15});
 const p=build(request(),s);assert.equal(p.refund_amount,100);assert.equal(p.accounting.consumed_cost_retained,40);
 assert.equal(p.accounting.by_brand.BB.consumed_cost,25);assert.equal(p.accounting.by_brand.HH.consumed_cost,15);
 assert.equal(build(request({disposition:'unprepared'}),s).stock_moves.length,1);
 assert.throws(()=>build(request({order_id:'ORD1-BB'}),s),e=>e.code==='FULL_TRANSACTION_REQUIRED');
});
test('unknown/closed day and cross-day refunds cannot produce a write plan',()=>{
 fails(s=>s.dayStates=[],'DAY_NOT_CONFIRMED_OPEN');fails(s=>s.dayStates[0].status='closed','DAY_NOT_CONFIRMED_OPEN');
 fails(s=>s.dayStates[0].locked=true,'DAY_NOT_CONFIRMED_OPEN');fails(s=>s.orders[0].business_date='2026-10-06','CROSS_DAY_REFUND_NOT_SUPPORTED');
 fails(s=>s.businessDate='2026-02-30','INVALID_DATE');
});
test('pending and committed refunds block new plans, including different operation IDs',()=>{
 fails(s=>s.operations=[{order_id:'ORD1',operation_id:'RFD-other-id',status:'pending'}],'REFUND_RECONCILIATION_REQUIRED');
 fails(s=>s.operations=[{order_id:'ORD1',operation_id:'RFD-other-id',status:'committed'}],'ALREADY_REFUNDED');
 fails(s=>s.inventoryTransactions.push({...s.inventoryTransactions[0],txn_id:'RESTORED',txn_type:'cancel_restock'}),'EXISTING_STOCK_REVERSAL');
});
test('missing, duplicate or inconsistent sale evidence fails closed',()=>{
 fails(s=>s.inventoryTransactions=[],'MISSING_SALE_LEDGER');
 fails(s=>s.inventoryTransactions.push({...s.inventoryTransactions[0]}),'DUPLICATE_OR_MISSING_TXN_ID');
 fails(s=>s.inventoryTransactions[0].qty_after=99,'INVALID_SALE_LEDGER');
 fails(s=>s.inventoryTransactions[0].transaction_value=11,'INVALID_SALE_LEDGER');
 fails(s=>s.inventoryTransactions[0].transaction_value='','MISSING_SALE_COST');
 fails(s=>s.inventoryTransactions.push({...s.inventoryTransactions[0],txn_id:'ITX2'}),'DUPLICATE_INGREDIENT_DEDUCTION');
});
test('do not infer units, restore negative stock, or fallback to present recipe costs',()=>{
 fails(s=>s.ingredients[0].unit='ml','STOCK_UNIT_CHANGED',{disposition:'unprepared'});
 fails(s=>s.ingredients[0].current_stock=-1,'NEGATIVE_OR_INVALID_STOCK',{disposition:'unprepared'});
 for(const v of ['',null,0,-1,Infinity])fails(s=>s.lines[0].cost_at_order=v,'MISSING_COST_SNAPSHOT');
 fails(s=>s.lines=[],'MISSING_COST_SNAPSHOT');
});
test('explicit disposition, reason and confirmed manual refund are required',()=>{
 for(const extra of [{disposition:''},{disposition:'partial'},{refund_confirmed:false},{refund_confirmed:'true'},{reason:''},{operation_id:'bad'}])assert.throws(()=>build(request(extra),fixture()));
});
test('exact family matching does not include unrelated prefix orders',()=>{
 const s=fixture();s.orders.push({...s.orders[0],order_id:'ORD1-other'});assert.deepEqual(build(request(),s).order_ids,['ORD1']);
 fails(s=>s.orders.push({...s.orders[0],order_id:'ORD1-BB'}),'AMBIGUOUS_ORDER_FAMILY');
 fails(s=>s.orders[0].order_id='ORD1-BB','INCOMPLETE_ORDER_FAMILY');
});
test('invalid totals, duplicate lines and unknown channels are rejected',()=>{
 fails(s=>s.orders[0].total_amount=61,'ORDER_TOTAL_MISMATCH');fails(s=>s.orders[0].payment_method='unknown','UNKNOWN_PAYMENT_CHANNEL');
 fails(s=>s.lines.push({...s.lines[0]}),'DUPLICATE_OR_MISSING_LINE_ID');fails(s=>s.orders[0].order_status='cancelled','ORDER_NOT_PAID_ACTIVE');
});
test('planner is deterministic and never mutates source objects',()=>{
 const s=fixture(),r=request(),before=JSON.stringify({s,r});const p=build(r,s);assert.deepEqual(build(r,s),p);assert.equal(JSON.stringify({s,r}),before);
 assert.equal(p.requires_atomic_commit,true);assert.equal(p.manual_refund_only,true);
});
