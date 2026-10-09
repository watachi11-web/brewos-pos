// Editor-only rollout. No public route. Does not edit any business row.
function brewRefundActivate_() {
  var props=PropertiesService.getScriptProperties(),proof=JSON.parse(props.getProperty('BREWOS_REFUND_LAST_TEST')||'null');
  if(!proof||!proof.passed||proof.release!==BREWOS_REFUND_RELEASE_ID||proof.id===CONFIG.SPREADSHEET_ID)throw Error('MATCHING_ISOLATED_TEST_REQUIRED');
  var lock=brewRefundSharedLock_();if(!lock.tryLock(30000))throw Error('WRITE_LOCK_TIMEOUT');
  try {
    if(props.getProperty(brewRefundFenceKey_()))throw Error('REFUND_RECONCILIATION_REQUIRED');
    var ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID),sheet=ss.getSheetByName('refund_operations');
    // Existing sheets are never overwritten, cleared or silently repaired.
    if(!sheet){
      var ids=ss.getSheets().map(function(s){return s.getSheetId();}),id=713140;
      while(ids.indexOf(id)!==-1)id++;
      Sheets.Spreadsheets.batchUpdate({requests:[
        {addSheet:{properties:{sheetId:id,title:'refund_operations',gridProperties:{rowCount:1000,columnCount:8,frozenRowCount:1}}}},
        {updateCells:{start:{sheetId:id,rowIndex:0,columnIndex:0},rows:[{values:BrewRefundBatch.operationHeaders.map(function(h){return {userEnteredValue:{stringValue:h}};})}],fields:'userEnteredValue'}}
      ]},CONFIG.SPREADSHEET_ID);
    }
    var records=brewRefundStore_().readOperations();
    BrewRefundReport.sum(records,'1900-01-01','9999-12-31','ALL');
    props.setProperty('BREWOS_REFUND_ENABLED','v1');
    if(props.getProperty('BREWOS_REFUND_ENABLED')!=='v1')throw Error('ACTIVATION_NOT_VERIFIED');
    Logger.log('REFUND_ACTIVATED '+BREWOS_REFUND_RELEASE_ID+' journal_records='+records.length);
    return {success:true,release:BREWOS_REFUND_RELEASE_ID,business_rows_changed:0};
  }finally{lock.releaseLock();}
}

// Read-only operator evidence for a stuck intent. No resets or blind replays.
function brewRefundInspectPending_() {
  var lock=brewRefundSharedLock_();if(!lock.tryLock(30000))throw Error('WRITE_LOCK_TIMEOUT');
  try {
    var store=brewRefundStore_(),fence=store.readFence(),operations=store.readOperations();
    var pending=operations.filter(function(o){return o.status!=='committed';});
    var result={fence:fence,pending:pending,committed_for_fence:fence?operations.filter(function(o){return o.operation_id===fence.operation_id&&o.status==='committed';}):[]};
    Logger.log(JSON.stringify(result));return result;
  }finally{lock.releaseLock();}
}

function brewRefundReconcilePending_(confirmation) {
  if(!brewRefundEnabled_())throw Error('REFUNDS_NOT_ENABLED');
  return BrewRefundCommit.reconcile(brewRefundStore_(),BrewRefundPlan,confirmation,Date.now());
}
