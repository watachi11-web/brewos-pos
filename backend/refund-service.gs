// STAGED integration adapter. No public doGet/doPost route is installed yet.
// All helpers end in '_' to prevent google.script.run access from hosted HTML.
// Production activation remains OFF until writer guards and all reports are wired.
function brewRefundEnabled_() {
  if(typeof brewRefundTestContext_!=='undefined'&&brewRefundTestContext_&&brewRefundTestContext_===CONFIG.SPREADSHEET_ID)return true;
  return PropertiesService.getScriptProperties().getProperty('BREWOS_REFUND_ENABLED')==='v1';
}
function brewRefundFenceKey_() {
  return typeof brewRefundTestContext_!=='undefined'&&brewRefundTestContext_?'BREWOS_REFUND_TEST_FENCE_'+brewRefundTestContext_:'BREWOS_REFUND_FENCE_V1';
}

function brewRefundTable_(ss,name) {
  var sh=ss.getSheetByName(name);
  if(!sh)throw Error('REFUND_SCHEMA_MISSING_'+name);
  var data=sh.getDataRange().getValues(),headers=(data[0]||[]).map(function(h){return String(h||'').trim();});
  if(!headers.length||headers.some(function(h){return !h;})||new Set(headers).size!==headers.length)throw Error('REFUND_SCHEMA_INVALID_'+name);
  var rows=[];
  data.slice(1).forEach(function(values,index){
    if(values.every(function(v){return v===''||v===null;}))return;
    var r={_row:index+1};headers.forEach(function(h,i){r[h]=values[i];});rows.push(r);
  });
  return {sheetId:sh.getSheetId(),headers:headers,rows:rows};
}

function brewRefundStore_() {
  var lock=typeof brewRefundSharedLock_==='function'?brewRefundSharedLock_():LockService.getScriptLock(),props=PropertiesService.getScriptProperties();
  var spreadsheetId=CONFIG.SPREADSHEET_ID,fenceKey=brewRefundFenceKey_(),ss,tables,prepared;
  function book_(){if(!ss)ss=SpreadsheetApp.openById(spreadsheetId);return ss;}
  function operations_(){
    // Read via the same API that commits. SpreadsheetApp's per-execution read
    // cache must not decide whether a Sheets API write succeeded.
    var data=Sheets.Spreadsheets.Values.get(spreadsheetId,"'refund_operations'!A:H",{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];
    var headers=data[0]||[];
    if(headers.length!==BrewRefundBatch.operationHeaders.length||BrewRefundBatch.operationHeaders.some(function(h,i){return headers[i]!==h;}))throw Error('REFUND_OPERATION_SCHEMA_INVALID');
    return data.slice(1).map(function(values,index){var row={_row:index+1};headers.forEach(function(h,i){row[h]=values[i]===undefined?'':values[i];});return row;}).filter(function(row){return headers.some(function(h){return row[h]!=='';});});
  }
  return {
    lock:function(){return lock.tryLock(CONFIG.WRITE_LOCK_TIMEOUT_MS||30000);},
    unlock:function(){lock.releaseLock();},
    readOperations:operations_,
    readFence:function(){var raw=props.getProperty(fenceKey);return raw?JSON.parse(raw):null;},
    setFence:function(value){
      if(props.getProperty(fenceKey))throw Error('REFUND_FENCE_EXISTS');
      var encoded=JSON.stringify(value);props.setProperty(fenceKey,encoded);
      if(props.getProperty(fenceKey)!==encoded)throw Error('REFUND_FENCE_NOT_VERIFIED');
    },
    clearFence:function(id){
      var raw=props.getProperty(fenceKey);
      if(!raw||JSON.parse(raw).operation_id!==id)throw Error('REFUND_FENCE_CONFLICT');
      props.deleteProperty(fenceKey);
    },
    snapshot:function(){
      if(typeof Sheets==='undefined')throw Error('SHEETS_SERVICE_UNAVAILABLE');
      tables={orders:brewRefundTable_(book_(),'orders'),ingredients:brewRefundTable_(book_(),'ingredients'),transactions:brewRefundTable_(book_(),'inventory_transactions'),operations:brewRefundTable_(book_(),'refund_operations')};
      var date=dailyCloseToday_(),closes=brewRefundTable_(book_(),'daily_closes');
      if(closes.headers.indexOf('date')<0||closes.headers.indexOf('status')<0)throw Error('DAILY_CLOSE_SCHEMA_INVALID');
      var days=closes.rows.filter(function(r){return normalizeDateKey_(r.date)===date;});
      if(days.length>1)throw Error('DAILY_CLOSE_DUPLICATE');
      var state=days.length?String(days[0].status).toLowerCase():'open';
      return {businessDate:date,dayStates:[{date:date,status:state,locked:state!=='open'&&state!=='reopened'}],orders:tables.orders.rows.map(function(r){return Object.assign({},r,{business_date:normalizeDateKey_(r.created_at)});}),lines:brewRefundTable_(book_(),'order_lines').rows,ingredients:tables.ingredients.rows,inventoryTransactions:tables.transactions.rows};
    },
    prepare:function(plan,result,fingerprint){
      prepared=BrewRefundBatch.prepare(plan,result,fingerprint,tables,Utilities.formatDate(new Date(),'Asia/Bangkok',"yyyy-MM-dd'T'HH:mm:ss"));return prepared;
    },
    reserve:function(plan,fingerprint){
      if(!prepared||prepared.record.operation_id!==plan.operation_id||prepared.record.request_json!==fingerprint)throw Error('REFUND_NOT_PREPARED');
      SpreadsheetApp.flush();
      Sheets.Spreadsheets.batchUpdate({requests:[prepared.intent],includeSpreadsheetInResponse:false},spreadsheetId);
    },
    commit:function(batch,pending){
      // Recovery can commit an existing intent without calling reserve(), so it
      // must also flush SpreadsheetApp's pre-commit buffers/read cache here.
      SpreadsheetApp.flush();
      Sheets.Spreadsheets.batchUpdate(BrewRefundBatch.commit(batch,pending),spreadsheetId);
    }
  };
}

function brewRefundOrder_(params) {
  if(!brewRefundEnabled_())return {success:false,code:'REFUNDS_NOT_ENABLED',stock_may_have_changed:false,do_not_retry:false};
  return BrewRefundCommit.execute(params,brewRefundStore_(),BrewRefundPlan);
}

// Required inside EACH existing mutating route's script-lock section, including
// submit/cancel, inventory receive/adjust/stocktake, day close/reopen and repairs.
// Pending reservation with no sheet row is still a blocker (in-flight API request).
function brewRefundAssertNoPending_(ss) {
  if(PropertiesService.getScriptProperties().getProperty(brewRefundFenceKey_()))throw Error('REFUND_RECONCILIATION_REQUIRED');
  ss=ss||SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  if(!ss.getSheetByName('refund_operations')) {
    if(brewRefundEnabled_())throw Error('REFUND_SCHEMA_MISSING_refund_operations');
    return;
  }
  var rows=typeof brewRefundOperations_==='function'?brewRefundOperations_():brewRefundStore_().readOperations();
  if(rows.some(function(r){return r.status!=='committed';}))throw Error('REFUND_RECONCILIATION_REQUIRED');
}

function brewRefundProjection_(from,to,brand) {
  // The outer report guard already validated this journal under the same lock.
  // Reuse that immutable read for every day/brand in dashboard trends.
  if(typeof brewRefundLockState_!=='undefined'&&brewRefundLockState_&&brewRefundLockState_.depth&&brewRefundLockState_.operations)return BrewRefundReport.sum(brewRefundLockState_.operations,from,to,brand||'ALL');
  var ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  brewRefundAssertNoPending_(ss);
  var rows=ss.getSheetByName('refund_operations')?(typeof brewRefundOperations_==='function'?brewRefundOperations_():brewRefundStore_().readOperations()):[];
  return BrewRefundReport.sum(rows,from,to,brand||'ALL');
}
