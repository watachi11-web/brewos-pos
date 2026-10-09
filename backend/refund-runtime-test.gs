// Editor-only isolated integration check. No HTTP or google.script.run entry.
// The fixture is synthetic and creates a NEW spreadsheet, never a production copy.
var brewRefundTestContext_;
function brewRefundIsolatedSelfTest_() {
  var production=CONFIG.SPREADSHEET_ID,props=PropertiesService.getScriptProperties();
  var date=dailyCloseToday_(),now=date+'T10:00:00',results=[];
  function check_(label,actual,expected){if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(label+': '+JSON.stringify(actual)+' != '+JSON.stringify(expected));results.push(label);}
  var fixture={
    orders:[['order_id','brand_id','created_at','order_status','payment_status','subtotal','discount_amount','total_amount','payment_method','notes','updated_at'],['TEST1','BB',now,'completed','paid',60,0,60,'qr','SYNTHETIC',now],['TEST2','HH',now,'completed','paid',40,0,40,'cash','SYNTHETIC',now]],
    order_lines:[['line_id','order_id','quantity','cost_at_order','line_total','product_id','product_name'],['L1','TEST1',1,25,60,'P1','TEST Coffee'],['L2','TEST2',1,10,40,'P2','TEST Food']],
    ingredients:[['ingredient_id','unit','current_stock','unit_cost'],['I1','g',60,0.5]],
    inventory_transactions:[['txn_id','ingredient_id','txn_type','quantity_change','unit_type','qty_before','qty_after','reference_id','notes','created_at','unit_cost_before','unit_cost_after','unit_price','transaction_value','source_doc_type','source_doc_id'],['T1','I1','sale_deduction',-20,'g',100,80,'TEST1','',now,0.5,0.5,0.5,10,'order','TEST1'],['T2','I1','sale_deduction',-20,'g',80,60,'TEST2','',now,0.5,0.5,0.5,10,'order','TEST2']],
    daily_closes:[['close_id','date','status']],products:[['product_id','cost_price'],['P1',25],['P2',10]],refund_operations:[BrewRefundBatch.operationHeaders]
  };
  var created=Sheets.Spreadsheets.create({properties:{title:'[TEST ONLY] BrewOS refunds '+date+' '+new Date().getTime(),timeZone:'Asia/Bangkok'},sheets:Object.keys(fixture).map(function(name,i){return {properties:{sheetId:i+1,title:name,gridProperties:{rowCount:100,columnCount:30}}};})});
  var id=created.spreadsheetId;
  if(!id||id===production)throw Error('TEST_ISOLATION_FAILED');
  props.setProperty('BREWOS_REFUND_LAST_TEST',JSON.stringify({id:id,release:BREWOS_REFUND_RELEASE_ID,passed:false}));
  try {
    CONFIG.SPREADSHEET_ID=id;brewRefundTestContext_=id;
    Sheets.Spreadsheets.batchUpdate({requests:Object.keys(fixture).map(function(name,i){return {updateCells:{start:{sheetId:i+1,rowIndex:0,columnIndex:0},rows:fixture[name].map(function(row){return {values:row.map(function(v){return {userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v)}};})};}),fields:'userEnteredValue'}};})},id);
    function report_(revenue,cost){
      var f=getFinanceSummary({month:date.slice(0,7)}),d=getDailyClosePreview({date:date}),b=getDashboardSummary({}),i=getInventoryStats(),r=getRefundAwareReport({date_from:date,date_to:date});
      check_('finance '+revenue,[f.revenue.total,f.cogs,f.net_profit,f.total_expenses],[revenue,cost,revenue-cost,0]);
      check_('daily '+revenue,[d.net_sales,d.cogs,d.gross_profit],[revenue,cost,revenue-cost]);
      check_('dashboard '+revenue,[b.today.revenue,b.today.cogs,b.today.profit],[revenue,cost,revenue-cost]);
      check_('inventory '+revenue,i.today_usage,cost);
      var total=r.orders.filter(isPaidActiveOrder_).reduce(function(n,o){return n+o.cogs;},0)+r.refund_cost_rows.reduce(function(n,o){return n+o.consumed_cost;},0);
      check_('report '+revenue,total,cost);
    }
    report_(100,35);
    var p={order_id:'TEST1',operation_id:'RFD-TEST-PREPARED-0001',disposition:'prepared',reason:'SYNTHETIC TEST ONLY',refund_confirmed:true};
    check_('prepared commit',brewRefundOrder_(p).success,true);
    check_('prepared retry',brewRefundOrder_(p).idempotent,true);
    report_(40,35);
    var u={order_id:'TEST2',operation_id:'RFD-TEST-UNPREPARED-0002',disposition:'unprepared',reason:'SYNTHETIC TEST ONLY',refund_confirmed:true};
    var interrupted=brewRefundStore_();interrupted.commit=function(){throw Error('INJECTED_TEST_INTERRUPTION');};
    check_('interrupted commit is unknown',BrewRefundCommit.execute(u,interrupted,BrewRefundPlan).code,'REFUND_RESULT_UNKNOWN');
    var blocked=false;try{getDailyClosePreview({date:date});}catch(e){blocked=e.message==='REFUND_RECONCILIATION_REQUIRED';}
    check_('unresolved refund blocks close preview',blocked,true);
    check_('interruption leaves stock intact',Sheets.Spreadsheets.Values.get(id,"'ingredients'!C2:D2",{valueRenderOption:'UNFORMATTED_VALUE'}).values,[[60,0.5]]);
    var recovery=brewRefundStore_(),fence=recovery.readFence();
    check_('operator recovery rejects missing confirmation',BrewRefundCommit.reconcile(recovery,BrewRefundPlan,'',Date.now()).code,'OPERATOR_CONFIRMATION_REQUIRED');
    // Synthetic clock advancement is confined to this isolated test.
    check_('unprepared operator recovery',BrewRefundCommit.reconcile(brewRefundStore_(),BrewRefundPlan,'FINISH '+u.operation_id+' EXECUTIONS TERMINAL AND POS PAUSED',fence.started_at_ms+16*60*1000).success,true);
    report_(0,25);
    var stock=Sheets.Spreadsheets.Values.get(id,"'ingredients'!C2:D2",{valueRenderOption:'UNFORMATTED_VALUE'}).values;
    check_('stock restored once',stock,[[80,0.5]]);
    // A valid first request + invalid second request must leave the first unapplied.
    var rejected=false;
    try {Sheets.Spreadsheets.batchUpdate({requests:[{updateCells:{start:{sheetId:3,rowIndex:1,columnIndex:2},rows:[{values:[{userEnteredValue:{numberValue:999}}]}],fields:'userEnteredValue'}},{updateCells:{start:{sheetId:999999,rowIndex:0,columnIndex:0},rows:[{values:[{userEnteredValue:{stringValue:'INVALID'}}]}],fields:'userEnteredValue'}}]},id);}catch(e){rejected=true;}
    check_('invalid batch rejected',rejected,true);
    check_('invalid batch atomicity',Sheets.Spreadsheets.Values.get(id,"'ingredients'!C2:D2",{valueRenderOption:'UNFORMATTED_VALUE'}).values,[[80,0.5]]);
    var proof={id:id,release:BREWOS_REFUND_RELEASE_ID,passed:true,checks:results.length,at:new Date().toISOString()};
    props.setProperty('BREWOS_REFUND_LAST_TEST',JSON.stringify(proof));
    Logger.log('REFUND_RUNTIME_PASS '+JSON.stringify(proof));return proof;
  } finally {CONFIG.SPREADSHEET_ID=production;brewRefundTestContext_=null;brewRefundLockState_=null;}
}
