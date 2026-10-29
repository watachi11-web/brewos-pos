// Editor-only: trailing '_' prevents google.script.run calls from web clients.
// Preparation makes a private full-workbook backup and adds an empty journal.
function brewSalePrepareRollout_(){
  var props=PropertiesService.getScriptProperties(),proof=JSON.parse(props.getProperty('BREWOS_SALE_LAST_TEST')||'null');
  if(!proof||!proof.passed||proof.release!==BREWOS_RECIPE_RELEASE_ID||proof.id===CONFIG.SPREADSHEET_ID)throw Error('MATCHING_ISOLATED_TEST_REQUIRED');
  var lock=brewRefundSharedLock_();if(!lock.tryLock(30000))throw Error('WRITE_LOCK_TIMEOUT');
  try{
    brewRefundAssertNoPending_();brewSaleAssertNoPending_();
    if(brewSaleEnabled_())throw Error('ALREADY_ACTIVATED');
    var key='BREWOS_SALE_PREPARED_'+CONFIG.SPREADSHEET_ID,old=props.getProperty(key);
    if(old)throw Error('ROLLOUT_ALREADY_PREPARED_INSPECT_FIRST');
    var ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID),sheets=ss.getSheets(),journal=ss.getSheetByName('sale_operations');
    if(journal&&journal.getLastRow()>1)throw Error('SALE_JOURNAL_NOT_EMPTY');
    var backup=ss.copy('[BACKUP] BrewOS before raw-at-sale '+new Date().toISOString());
    if(backup.getId()===CONFIG.SPREADSHEET_ID||backup.getSheets().length!==sheets.length)throw Error('BACKUP_NOT_VERIFIED');
    sheets.forEach(function(s){var copy=backup.getSheetByName(s.getName());if(!copy||copy.getLastRow()!==s.getLastRow()||copy.getLastColumn()!==s.getLastColumn())throw Error('BACKUP_SHAPE_MISMATCH_'+s.getName());});
    // Record the backup before any journal provisioning; never silently overwrite it.
    var record={release:BREWOS_RECIPE_RELEASE_ID,spreadsheet_id:CONFIG.SPREADSHEET_ID,backup_id:backup.getId(),prepared_at:new Date().toISOString(),status:'backup_verified'};
    props.setProperty(key,JSON.stringify(record));
    if(!journal){
      var used=sheets.map(function(s){return s.getSheetId();}),sid=713141;while(used.indexOf(sid)!==-1)sid++;
      Sheets.Spreadsheets.batchUpdate({requests:[{addSheet:{properties:{sheetId:sid,title:'sale_operations',gridProperties:{rowCount:1000,columnCount:5,frozenRowCount:1}}}},{updateCells:{start:{sheetId:sid,rowIndex:0,columnIndex:0},rows:[{values:BrewSaleBatch.columns.sale_operations.map(function(h){return {userEnteredValue:{stringValue:h}};})}],fields:'userEnteredValue'}}]},CONFIG.SPREADSHEET_ID);
    }
    brewSaleStore_().readCommitted('RCP-ROLLOUT-SCHEMA-CHECK');
    record.status='prepared';props.setProperty(key,JSON.stringify(record));console.log('SALE_ROLLOUT_PREPARED '+JSON.stringify(record));return record;
  }finally{lock.releaseLock();}
}
function brewSaleActivate_(){
  var props=PropertiesService.getScriptProperties(),prepared=JSON.parse(props.getProperty('BREWOS_SALE_PREPARED_'+CONFIG.SPREADSHEET_ID)||'null'),proof=JSON.parse(props.getProperty('BREWOS_SALE_LAST_TEST')||'null');
  if(!prepared||prepared.status!=='prepared'||prepared.release!==BREWOS_RECIPE_RELEASE_ID||prepared.spreadsheet_id!==CONFIG.SPREADSHEET_ID||!proof||!proof.passed||proof.release!==BREWOS_RECIPE_RELEASE_ID)throw Error('VERIFIED_ROLLOUT_REQUIRED');
  var lock=brewRefundSharedLock_();if(!lock.tryLock(30000))throw Error('WRITE_LOCK_TIMEOUT');
  try{
    brewRefundAssertNoPending_();brewSaleAssertNoPending_();
    if(brewSaleEnabled_())return {success:true,already_enabled:true};
    var ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID),context=brewRecipeSnapshot_(ss),mods=buildModifierConfig_(ss),checked=0;
    context.products.forEach(function(p){
      if(isFalse(p.is_available)||isTrue(p.is_deleted))return;
      var variants=[[]];(mods.byProduct[p.product_id]||[]).forEach(function(g){g.options.forEach(function(o){variants.push([{group_id:g.group_id,option_id:o.option_id}]);});});
      variants.forEach(function(v){var item={id:p.product_id,name:p.name,qty:1,modifiers:v};item._resolved_modifiers=resolveItemModifiers_(item,p.product_id,mods,true).selections;brewRecipePlanItems_(context,[item]);checked++;});
    });
    if(!checked)throw Error('NO_READY_PRODUCTS');
    if(brewRefundTable_(ss,'sale_operations').rows.length)throw Error('SALE_JOURNAL_NOT_EMPTY');
    var cutover={release:BREWOS_RECIPE_RELEASE_ID,at:new Date().toISOString(),variants_checked:checked,mode:'raw_at_sale',manual_prep_deductions:false};
    props.setProperty('BREWOS_SALE_CUTOVER_'+CONFIG.SPREADSHEET_ID,JSON.stringify(cutover));
    props.setProperty('BREWOS_SALE_ENABLED_'+CONFIG.SPREADSHEET_ID,'raw-at-sale-v1');
    if(!brewSaleEnabled_())throw Error('ACTIVATION_NOT_VERIFIED');
    console.log('SALE_ACTIVATED '+JSON.stringify(cutover));return {success:true,cutover:cutover};
  }finally{lock.releaseLock();}
}
