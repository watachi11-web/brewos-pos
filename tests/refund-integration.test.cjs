const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {build,writers,readers}=require('../backend/build-refund-release.cjs');
const baseline=path.resolve(__dirname,'../../../outputs/BrewOS-Purchase-Cashflow-Repair/BrewOS-release.gs');
// Private production baseline is deliberately not checked into the public repo.
// Local integration must run with BREWOS_BASELINE set, or the known workspace copy.
const sourcePath=process.env.BREWOS_BASELINE||baseline;
const source=fs.existsSync(sourcePath)?build(fs.readFileSync(sourcePath,'utf8')):'';
const integrationTest=source?test:(name,fn)=>test(name,{skip:'Set BREWOS_BASELINE to the private reviewed production snapshot'},fn);
function setup(){
 const today='2026-10-08',data={
  orders:[['order_id','brand_id','created_at','order_status','payment_status','subtotal','discount_amount','total_amount','payment_method','notes','updated_at'],['O1','BB',today+'T10:00:00','completed','paid',60,0,60,'qr','',today],['O2','HH',today+'T10:00:00','completed','paid',40,0,40,'cash','',today]],
  order_lines:[['line_id','order_id','quantity','cost_at_order','line_total','product_id','product_name'],['L1','O1',1,25,60,'P1','Test coffee'],['L2','O2',1,10,40,'P2','Test food']],
  ingredients:[['ingredient_id','unit','current_stock','unit_cost'],['I1','g',60,0.5]],
  inventory_transactions:[['txn_id','ingredient_id','txn_type','quantity_change','unit_type','qty_before','qty_after','reference_id','notes','created_at','unit_cost_before','unit_cost_after','unit_price','transaction_value','source_doc_type','source_doc_id'],['T1','I1','sale_deduction',-20,'g',100,80,'O1','',today,0.5,0.5,0.5,10,'order','O1'],['T2','I1','sale_deduction',-20,'g',80,60,'O2','',today,0.5,0.5,0.5,10,'order','O2']],
  daily_closes:[['close_id','date','status']],products:[['product_id','cost_price'],['P1',25],['P2',10]],
  refund_operations:[['operation_id','order_id','business_date','status','request_json','plan_json','result_json','created_at']]
 };
 const props=new Map([['BREWOS_REFUND_ENABLED','v1']]),ids=Object.fromEntries(Object.keys(data).map((k,i)=>[k,i+1]));let held=false,gets=0,acquires=0;
 const book={getSheetByName(name){if(!data[name])return null;return {getSheetId:()=>ids[name],getDataRange:()=>({getValues:()=>JSON.parse(JSON.stringify(data[name]))})};}};
 const context=vm.createContext({console,Logger:{log(){}},Date:class extends Date{constructor(...a){super(...a.length?a:[today+'T05:00:00Z']);}},
  Utilities:{formatDate(d,_tz,f){const iso=new Date(d).toISOString();if(f==='yyyy-MM-dd')return iso.slice(0,10);if(f==='dd/MM')return iso.slice(8,10)+'/'+iso.slice(5,7);return iso.slice(0,19);}},
  LockService:{getScriptLock:()=>({tryLock(){if(held)return false;held=true;acquires++;return true;},releaseLock(){assert.ok(held);held=false;}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},
  SpreadsheetApp:{openById:()=>book,flush(){}},
  Sheets:{Spreadsheets:{Values:{get(){gets++;return {values:JSON.parse(JSON.stringify(data.refund_operations))};}},batchUpdate(body){
   assert.ok(held);const draft=JSON.parse(JSON.stringify(data));
   for(const req of body.requests){const a=req.updateCells||req.appendCells,n=Object.keys(ids).find(k=>ids[k]===(a.sheetId??a.start.sheetId));
    const val=c=>c.userEnteredValue.numberValue??c.userEnteredValue.stringValue;
    if(req.appendCells)a.rows.forEach(r=>draft[n].push(r.values.map(val)));
    else draft[n][a.start.rowIndex][a.start.columnIndex]=val(a.rows[0].values[0]);
   }Object.assign(data,draft);return {};
  }}}
 });vm.runInContext(source,context);
 return {data,props,context,run:s=>vm.runInContext(s,context),counts:()=>({gets,acquires,held})};
}
integrationTest('integrated production calculations agree before/after prepared and unprepared refunds',()=>{
 const h=setup();
 function check(revenue,cogs){
  const daily=h.run("getDailyClosePreview({date:'2026-10-08'})"),finance=h.run("getFinanceSummary({month:'2026-10'})"),dashboard=h.run('getDashboardSummary({})'),inventory=h.run('getInventoryStats()'),report=h.run("getRefundAwareReport({date_from:'2026-10-01',date_to:'2026-10-08'})");
  assert.equal(daily.net_sales,revenue);assert.equal(daily.cogs,cogs);assert.equal(daily.gross_profit,revenue-cogs);
  assert.equal(finance.revenue.total,revenue);assert.equal(finance.cogs,cogs);assert.equal(finance.net_profit,revenue-cogs);assert.equal(finance.total_expenses,0);
  assert.equal(finance.brand.bb.cogs+finance.brand.hh.cogs,cogs);
  assert.equal(dashboard.today.revenue,revenue);assert.equal(dashboard.today.cogs,cogs);assert.equal(dashboard.today.profit,revenue-cogs);assert.equal(dashboard.profit_trend.at(-1),revenue-cogs);
  assert.equal(inventory.today_usage,cogs);
  const active=report.orders.filter(o=>o.order_status!=='cancelled');assert.equal(active.reduce((n,o)=>n+o.cogs,0)+report.refund_cost_rows.reduce((n,r)=>n+r.consumed_cost,0),cogs);
 }
 check(100,35);
 assert.equal(h.run("brewRefundOrder_({order_id:'O1',operation_id:'RFD-12345678',disposition:'prepared',reason:'test',refund_confirmed:true})").success,true);
 check(40,35);assert.equal(h.data.ingredients[1][2],60);
 assert.equal(h.run("brewRefundOrder_({order_id:'O2',operation_id:'RFD-87654321',disposition:'unprepared',reason:'test',refund_confirmed:true})").success,true);
 check(0,25);assert.equal(h.data.ingredients[1][2],80);assert.equal(h.data.ingredients[1][3],0.5);
});
integrationTest('all wrapped entry points reject pending refund before invoking old bodies',()=>{
 const h=setup();h.props.set('BREWOS_REFUND_FENCE_V1','{}');
 for(const name of writers.concat(readers))assert.throws(()=>h.run(name+'({})'),/REFUND_RECONCILIATION_REQUIRED/,name);
 assert.equal(h.counts().held,false);
});
integrationTest('nested same-execution reports use one native lock and one journal read',()=>{
 const h=setup(),before=h.counts();h.run('getDashboardSummary({period_days:90})');const after=h.counts();
 assert.equal(after.acquires-before.acquires,1);assert.equal(after.gets-before.gets,1);assert.equal(after.held,false);
});
integrationTest('legacy cancellation is retired and disabled feature performs no writes',()=>{
 const h=setup(),original=JSON.stringify(h.data);assert.equal(h.run("cancelOrder({order_id:'O1'})").code,'USE_REFUND_FLOW');
 h.props.delete('BREWOS_REFUND_ENABLED');assert.equal(h.run('brewRefundOrder_({})').code,'REFUNDS_NOT_ENABLED');assert.equal(JSON.stringify(h.data),original);
});
test('release builder refuses a changed baseline instead of patching blindly',()=>{assert.throws(()=>build(source),/Baseline changed/);});
