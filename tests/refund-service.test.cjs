const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(){
 const operations=['operation_id','order_id','business_date','status','request_json','plan_json','result_json','created_at'];
 const data={
  orders:[['order_id','brand_id','created_at','order_status','payment_status','subtotal','discount_amount','total_amount','payment_method','notes','updated_at'],['O1','BB','2026-10-08T10:00:00','completed','paid',60,0,60,'qr','', '2026-10-08T10:00:00']],
  order_lines:[['line_id','order_id','quantity','cost_at_order'],['L1','O1',1,25]],
  ingredients:[['ingredient_id','unit','current_stock','unit_cost'],['I1','g',80,0.5]],
  inventory_transactions:[['txn_id','ingredient_id','txn_type','quantity_change','unit_type','qty_before','qty_after','reference_id','notes','created_at','unit_cost_before','unit_cost_after','unit_price','transaction_value','source_doc_type','source_doc_id'],['T1','I1','sale_deduction',-20,'g',100,80,'O1','','2026-10-08T10:00:00',0.5,0.5,0.5,10,'order','O1']],
  daily_closes:[['date','status']],refund_operations:[operations]
 };
 const ids=Object.fromEntries(Object.keys(data).map((name,i)=>[name,i+1])),props=new Map(),calls=[];let acquired=false;
 const context=vm.createContext({console,Date,Set,Map,CONFIG:{SPREADSHEET_ID:'MOCK-ONLY'},dailyCloseToday_:()=> '2026-10-08',normalizeDateKey_:s=>String(s).slice(0,10),
  Utilities:{formatDate:()=> '2026-10-08T11:00:00'},
  LockService:{getScriptLock:()=>({tryLock(){if(acquired)return false;acquired=true;return true;},releaseLock(){acquired=false;}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},
  SpreadsheetApp:{flush(){calls.push('flush');},openById(id){assert.equal(id,'MOCK-ONLY');return {getSheetByName(name){return data[name]?{getSheetId:()=>ids[name],getDataRange:()=>({getValues:()=>name==='refund_operations'?[operations]:data[name]})}:null;}};}},
  Sheets:{Spreadsheets:{Values:{get(id,range){assert.equal(id,'MOCK-ONLY');assert.equal(range,"'refund_operations'!A:H");calls.push('api-read');return {values:JSON.parse(JSON.stringify(data.refund_operations))};}},batchUpdate(body,id){
   assert.equal(id,'MOCK-ONLY');assert.equal(acquired,true);calls.push(body);
   for(const request of body.requests){const a=request.appendCells||request.updateCells,name=Object.keys(ids).find(n=>ids[n]===(a.sheetId??a.start.sheetId));
    if(request.appendCells)for(const row of a.rows)data[name].push(row.values.map(c=>c.userEnteredValue.numberValue??c.userEnteredValue.stringValue));
    else data[name][a.start.rowIndex][a.start.columnIndex]=a.rows[0].values[0].userEnteredValue.numberValue??a.rows[0].values[0].userEnteredValue.stringValue;
   }return {};
  }}}
 });
 for(const file of ['refund-plan.js','refund-commit.js','refund-batch.js','refund-report.js','refund-service.gs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend',file),'utf8'),context);
 const run=s=>vm.runInContext(s,context);
 return {run,context,data,props,calls,unlock:()=>{acquired=false;}};
}
const request="{order_id:'O1',operation_id:'RFD-12345678',disposition:'prepared',reason:'confirmed',refund_confirmed:true}";
test('staged Apps Script entry remains disabled and makes no service calls',()=>{
 const h=setup();assert.equal(h.run('brewRefundOrder_('+request+')').code,'REFUNDS_NOT_ENABLED');assert.equal(h.calls.length,0);assert.equal(h.props.size,0);
});
test('adapter uses fresh API journal reads even if SpreadsheetApp cache is stale',()=>{
 const h=setup();h.run('brewRefundEnabled_=function(){return true;}');const r=h.run('brewRefundOrder_('+request+')');
 assert.equal(r.success,true);assert.equal(h.data.orders[1][3],'cancelled');assert.equal(h.data.refund_operations[1][3],'committed');assert.equal(h.props.size,0);
 const writes=h.calls.filter(c=>typeof c==='object').length;assert.equal(writes,2);
 for(let i=0;i<h.calls.length;i++)if(typeof h.calls[i]==='object')assert.equal(h.calls[i-1],'flush','Flush SpreadsheetApp before each Sheets write, including recovery commits');
 assert.equal(h.run('brewRefundOrder_('+request+')').idempotent,true);assert.equal(h.calls.filter(c=>typeof c==='object').length,writes);
});
test('pending fence blocks other writes even if no journal row is visible yet',()=>{
 const h=setup();h.props.set('BREWOS_REFUND_FENCE_V1',JSON.stringify({operation_id:'RFD-12345678'}));assert.throws(()=>h.run('brewRefundAssertNoPending_()'),/RECONCILIATION/);
});
test('missing daily-close table is not interpreted as an open day',()=>{
 const h=setup();delete h.data.daily_closes;h.run('brewRefundEnabled_=function(){return true;}');const r=h.run('brewRefundOrder_('+request+')');assert.equal(r.success,false);assert.match(r.code,/SCHEMA_MISSING/);assert.equal(h.props.size,0);assert.equal(h.calls.filter(c=>typeof c==='object').length,0);
});
test('adapter refuses duplicate daily closes and reordered operation headers',()=>{
 const h=setup();h.data.daily_closes.push(['2026-10-08','open'],['2026-10-08','closed']);h.run('brewRefundEnabled_=function(){return true;}');assert.equal(h.run('brewRefundOrder_('+request+')').code,'DAILY_CLOSE_DUPLICATE');
 const p=setup();p.data.refund_operations[0][0]='incorrect';p.run('brewRefundEnabled_=function(){return true;}');assert.equal(p.run('brewRefundOrder_('+request+')').code,'REFUND_OPERATION_SCHEMA_INVALID');
});
