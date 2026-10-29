// Synthetic Sheets runtime fixture. No real customer/order/stock data is copied.
function brewSaleIsolatedSelfTest_(){
  var production=CONFIG.SPREADSHEET_ID,props=PropertiesService.getScriptProperties(),date=dailyCloseToday_(),checks=[];
  function check(label,a,b){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label+': '+JSON.stringify(a)+' != '+JSON.stringify(b));checks.push(label);}
  var fixture={orders:[BrewSaleBatch.columns.orders],order_lines:[BrewSaleBatch.columns.order_lines],order_line_modifiers:[BrewSaleBatch.columns.order_line_modifiers],sale_operations:[BrewSaleBatch.columns.sale_operations],refund_operations:[BrewRefundBatch.operationHeaders],
    ingredients:[['ingredient_id','unit','current_stock','unit_cost'],['ING-001','g',1000,0.1],['PKG-001','pcs',100,2]],
    inventory_transactions:[['txn_id','ingredient_id','brand_id','txn_type','quantity_change','unit_type','qty_before','qty_after','reference_id','notes','performed_by','created_at','unit_cost_before','unit_cost_after','unit_price','transaction_value','supplier_id','source_doc_type','source_doc_id','shortage_qty']],
    products:[['product_id','name','brand_id','is_available','is_deleted','bom_status','cost_price'],['PRD-001','TEST food','HH',true,false,'READY',14.5],['PRD-002','TEST coffee','BB',true,false,'READY',4]],
    recipe_ingredients:[['product_id','ingredient_id','qty_used','unit'],['PRD-001','SUB-001',100,'g'],['PRD-001','PKG-001',1,'pcs'],['PRD-002','ING-001',20,'g'],['PRD-002','PKG-001',1,'pcs']],
    sub_recipes:[['product_id','ingredient_id','qty_used','unit','batch_yield_qty','batch_yield_unit'],['SUB-001','ING-001',500,'g',400,'g']],
    daily_closes:[['close_id','date','status']],modifier_groups:[['group_id']],modifier_options:[['option_id']],product_modifier_groups:[['product_id']]
  };
  var names=Object.keys(fixture),created=Sheets.Spreadsheets.create({properties:{title:'[TEST ONLY] BrewOS atomic recipes '+date+' '+Date.now(),timeZone:'Asia/Bangkok'},sheets:names.map(function(n,i){return {properties:{sheetId:i+1,title:n,gridProperties:{rowCount:100,columnCount:30}}};})}),id=created.spreadsheetId;
  if(!id||id===production)throw Error('TEST_ISOLATION_FAILED');
  console.log('ATOMIC_SALE_TEST_BOOK https://docs.google.com/spreadsheets/d/'+id+'/edit');
  var baseStore=brewSaleStore_,enabledKey='BREWOS_SALE_ENABLED_'+id;
  try{
    CONFIG.SPREADSHEET_ID=id;brewRefundTestContext_=id;props.setProperty(enabledKey,'raw-at-sale-v1');
    Sheets.Spreadsheets.batchUpdate({requests:names.map(function(n,i){return {updateCells:{start:{sheetId:i+1,rowIndex:0,columnIndex:0},rows:fixture[n].map(function(row){return {values:row.map(function(v){return {userEnteredValue:typeof v==='number'?{numberValue:v}:typeof v==='boolean'?{boolValue:v}:{stringValue:String(v)}};})};}),fields:'userEnteredValue'}};})},id);
    function values(name,range){return Sheets.Spreadsheets.Values.get(id,"'"+name+"'!"+range,{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];}
    var p={receipt_id:'RCP-RUNTIME-001',customer_name:'SYNTHETIC ONLY',items:[{id:'PRD-001',name:'TEST food',qty:2,price:30}],grand:60,payment_method:'qr'};
    check('old mobile must refresh',submitOrderDirect(p).code,'SALE_CLIENT_UPGRADE_REQUIRED');p.sale_client_version='atomic-v1';
    var first=submitOrderDirect(p);check('atomic sale success',first.success,true);check('raw and package stock',values('ingredients','C2:C3'),[[750],[98]]);
    check('exact journal status',brewSaleStatus_(p).verified,true);
    check('one orders row',values('orders','A1:A20').length,2);check('one sale journal',values('sale_operations','A1:A20').length,2);
    check('snapshot cost',values('order_lines','I2:I2'),[[14.5]]);
    check('same receipt idempotent',submitOrderDirect(p).idempotent,true);check('retry preserves stock',values('ingredients','C2:C3'),[[750],[98]]);
    var changed=JSON.parse(JSON.stringify(p));changed.items[0].id='PRD-002';check('same total different items collision',submitOrderDirect(changed).code,'ORDER_ID_COLLISION');
    var refunded=brewRefundOrder_({order_id:p.receipt_id,operation_id:'RFD-RUNTIME-UNPREPARED-001',disposition:'unprepared',reason:'SYNTHETIC ONLY',refund_confirmed:true});
    check('unprepared refund success',refunded.success,true);check('unprepared restores original stock',values('ingredients','C2:C3'),[[1000],[100]]);
    p.receipt_id='RCP-RUNTIME-002';p.items=[{id:'PRD-001',name:'TEST food',qty:1,price:30},{id:'PRD-002',name:'TEST coffee',qty:1,price:40}];p.discount={type:'amt',value:7};p.grand=63;
    var mixed=submitOrderDirect(p);check('mixed success',mixed.success,true);check('mixed net',mixed.grand,63);check('shared raw once',values('ingredients','C2:C3'),[[855],[98]]);
    var prepared=brewRefundOrder_({order_id:p.receipt_id,operation_id:'RFD-RUNTIME-PREPARED-002',disposition:'prepared',reason:'SYNTHETIC ONLY',refund_confirmed:true});
    check('prepared refund success',prepared.success,true);check('prepared keeps consumed stock',values('ingredients','C2:C3'),[[855],[98]]);
    var finance=getFinanceSummary({month:date.slice(0,7)}),daily=getDailyClosePreview({date:date}),inventory=getInventoryStats();
    check('finance retained COGS',[finance.revenue.total,finance.cogs],[0,18.5]);check('daily retained COGS',[daily.net_sales,daily.cogs],[0,18.5]);check('inventory retained COGS',inventory.today_usage,18.5);
    p.receipt_id='RCP-RUNTIME-003';p.items=[{id:'PRD-002',name:'TEST coffee',qty:1,price:40}];delete p.discount;p.grand=40;
    brewSaleStore_=function(){var store=baseStore(),commit=store.commit;store.commit=function(batch){commit(batch);throw Error('INJECTED LOST RESPONSE AFTER COMMIT');};return store;};
    check('lost response uncertain',submitOrderDirect(p).code,'SALE_RESULT_UNKNOWN');brewSaleStore_=baseStore;
    check('lost response read-only verified',brewSaleStatus_(p).verified,true);
    check('lost response verified retry',submitOrderDirect(p).idempotent,true);check('lost response deducts once',values('ingredients','C2:C3'),[[835],[97]]);
    p.receipt_id='RCP-RUNTIME-004';
    brewSaleStore_=function(){var store=baseStore();store.commit=function(){throw Error('INJECTED BEFORE COMMIT');};return store;};
    check('precommit failure uncertain',submitOrderDirect(p).code,'SALE_RESULT_UNKNOWN');brewSaleStore_=baseStore;
    check('absent journal never replays',submitOrderDirect(p).code,'SALE_RECONCILIATION_REQUIRED');check('rejection leaves stock',values('ingredients','C2:C3'),[[835],[97]]);
    var blocked=false;try{adjustStock({ingredient_id:'ING-001',adjust_type:'set',amount:0});}catch(e){blocked=e.message==='SALE_RECONCILIATION_REQUIRED';}check('pending blocks stock writes',blocked,true);
    // Clear only the known synthetic pre-commit injected failure in this fixture.
    if(CONFIG.SPREADSHEET_ID===production)throw Error('TEST_ISOLATION_LOST');props.deleteProperty(brewSaleFenceKey_());
    var modifierRows={modifier_groups:[['group_id','name','required','min_select','max_select','is_active'],['MG-TEST','TEST extra',true,1,1,true]],modifier_options:[['option_id','group_id','ingredient_id','qty_used','unit','price_delta','is_default','is_active'],['MO-TEST','MG-TEST','ING-001',10,'g',5,true,true]],product_modifier_groups:[['product_id','group_id','is_active'],['PRD-002','MG-TEST',true]]};
    Sheets.Spreadsheets.batchUpdate({requests:Object.keys(modifierRows).map(function(n){return {updateCells:{start:{sheetId:names.indexOf(n)+1,rowIndex:0,columnIndex:0},rows:modifierRows[n].map(function(row){return {values:row.map(function(v){return {userEnteredValue:typeof v==='number'?{numberValue:v}:typeof v==='boolean'?{boolValue:v}:{stringValue:v}};})};}),fields:'userEnteredValue'}};})},id);
    p.receipt_id='RCP-RUNTIME-005';p.items[0].modifiers=[{group_id:'MG-TEST',option_id:'MO-TEST'}];p.grand=45;
    var modified=submitOrderDirect(p);check('modifier sale success',modified.success,true);check('modifier revenue',modified.grand,45);
    check('modifier stock consumed once',values('ingredients','C2:C3'),[[805],[96]]);
    check('modifier ledger quantity',values('order_line_modifiers','K2:K2'),[[10]]);
    var priorJournal=values('sale_operations','A1:A20').length,rejected=false;
    try{Sheets.Spreadsheets.batchUpdate({requests:[{appendCells:{sheetId:names.indexOf('sale_operations')+1,rows:[{values:[{userEnteredValue:{stringValue:'MUST-NOT-COMMIT'}}]}],fields:'userEnteredValue'}},{updateCells:{start:{sheetId:9999999,rowIndex:0,columnIndex:0},rows:[{values:[{userEnteredValue:{stringValue:'INVALID'}}]}],fields:'userEnteredValue'}}]},id);}catch(e){rejected=true;}
    check('invalid atomic batch rejected',rejected,true);check('invalid batch writes no partial journal',values('sale_operations','A1:A20').length,priorJournal);
    var proof={passed:true,id:id,release:BREWOS_RECIPE_RELEASE_ID,checks:checks.length,at:new Date().toISOString()};
    props.setProperty('BREWOS_SALE_LAST_TEST',JSON.stringify(proof));console.log('ATOMIC_SALE_RUNTIME_PASS '+JSON.stringify(proof));return proof;
  } finally{brewSaleStore_=baseStore;props.deleteProperty(enabledKey);CONFIG.SPREADSHEET_ID=production;brewRefundTestContext_=null;brewRefundLockState_=null;}
}
