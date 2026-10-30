// Candidate adapter. Activation is editor-only after isolated runtime tests.
function brewSaleEnabled_(){return PropertiesService.getScriptProperties().getProperty('BREWOS_SALE_ENABLED_'+CONFIG.SPREADSHEET_ID)==='raw-at-sale-v1';}
// Read-only wrappers for the Apps Script hosted POS. No editor helpers exposed.
function getSaleReadiness(){return {atomic_sales:brewSaleEnabled_(),customer_linking:true};}
function getSaleStatus(params){return brewSaleStatus_(params||{});}
function brewSaleDirect_(p){
  if(!p||p.sale_client_version!=='atomic-v1')return {success:false,error:'กรุณารีโหลดหน้า POS เป็นรุ่นใหม่ก่อนบันทึก',code:'SALE_CLIENT_UPGRADE_REQUIRED',do_not_retry:false,result_unknown:false};
  return brewSaleArgs_([p.customer_name,p.room,p.pickup_time,p.note,p.items,p.grand,p.receipt_id,p.datetime,p.discount,p.payment_method,p.customer_id]);
}
function brewSaleFenceKey_(){return 'BREWOS_SALE_FENCE_'+CONFIG.SPREADSHEET_ID;}
function brewSaleAssertNoPending_(){if(PropertiesService.getScriptProperties().getProperty(brewSaleFenceKey_()))throw Error('SALE_RECONCILIATION_REQUIRED');}
function brewSaleHash_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');}
function brewSaleStore_(){
  var lock=brewRefundSharedLock_(),props=PropertiesService.getScriptProperties(),id=CONFIG.SPREADSHEET_ID,key=brewSaleFenceKey_(),ss,tables;
  function book(){if(!ss)ss=SpreadsheetApp.openById(id);return ss;}
  function committed(orderId){
    var data=Sheets.Spreadsheets.Values.get(id,"'sale_operations'!A:E",{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];
    var hdrs=data[0]||[],expected=BrewSaleBatch.columns.sale_operations;
    if(hdrs.length!==expected.length||expected.some(function(h,i){return hdrs[i]!==h;}))throw Error('SALE_OPERATION_SCHEMA_INVALID');
    return data.slice(1).map(function(v){var r={};hdrs.forEach(function(h,i){r[h]=v[i]===undefined?'':v[i];});return r;}).filter(function(r){return r.order_id===orderId;});
  }
  return {
    lock:function(){return lock.tryLock(CONFIG.WRITE_LOCK_TIMEOUT_MS||30000);},unlock:function(){lock.releaseLock();},
    fingerprint:brewSaleHash_,assertNoRefundPending:function(){brewRefundAssertNoPending_();},
    readCommitted:committed,
    readFence:function(){var v=props.getProperty(key);return v?JSON.parse(v):null;},
    setFence:function(f){if(props.getProperty(key))throw Error('SALE_FENCE_EXISTS');props.setProperty(key,JSON.stringify(f));},
    clearFence:function(orderId,fp){var v=JSON.parse(props.getProperty(key)||'null');if(!v||v.order_id!==orderId||v.fingerprint!==fp)throw Error('SALE_FENCE_CONFLICT');props.deleteProperty(key);},
    hasLegacyOrder:function(orderId){return findExistingOrderFamily_(book().getSheetByName('orders'),orderId).length>0;},
    snapshot:function(){
      if(!brewSaleEnabled_())throw Error('ATOMIC_SALES_NOT_ENABLED');
      tables={};['orders','order_lines','order_line_modifiers','ingredients','inventory_transactions','sale_operations'].forEach(function(n){tables[n]=brewRefundTable_(book(),n);});
      return {ss:book(),recipe:brewRecipeSnapshot_(book())};
    },
    prepare:function(plan,fingerprint){return BrewSaleBatch.prepare(plan,fingerprint,tables);},
    commit:function(batch){SpreadsheetApp.flush();Sheets.Spreadsheets.batchUpdate(batch,id);}
  };
}
function brewSaleRequest_(args){
    // Use the same normalization for submission and read-only recovery.
    var items=typeof args[4]==='string'?JSON.parse(args[4]):args[4];
    var discount=args[8]?(typeof args[8]==='string'?JSON.parse(args[8]):args[8]):null;
    var request={order_id:String(args[6]||'').trim(),customer:String(args[0]||'Walk-in'),room:String(args[1]||''),pickup:String(args[2]||''),note:String(args[3]||''),items:items,grand:Number(args[5]||0),datetime:String(args[7]||''),discount:discount,payment:String(args[9]||'cash')};
    // Omit absent customer ID to preserve pre-upgrade pending request hashes.
    if(args[10]!==undefined&&args[10]!==null&&String(args[10]).trim())request.customer_id=String(args[10]).trim();
    return request;
}
function brewSaleStatus_(p){
  var store=brewSaleStore_(),locked=false;
  try{
    if(!brewSaleEnabled_())return {success:false,code:'ATOMIC_SALES_NOT_ENABLED'};
    // This route deliberately supports only the canonical web-client fields.
    var r=brewSaleRequest_([p.customer_name,p.room,p.pickup_time,p.note,p.items,p.grand,p.receipt_id,p.datetime,p.discount,p.payment_method,p.customer_id]);
    if(!/^RCP-[A-Za-z0-9_-]{2,116}$/.test(r.order_id))throw Error('CLIENT_ORDER_ID_REQUIRED');
    if(!store.lock())throw Error('WRITE_LOCK_TIMEOUT');locked=true;
    var rows=store.readCommitted(r.order_id),fp=brewSaleHash_(BrewSaleCommit.canonical(r));
    if(rows.length!==1||rows[0].status!=='committed')throw Error('SALE_RECONCILIATION_REQUIRED');
    if(rows[0].fingerprint!==fp)throw Error('ORDER_ID_COLLISION');
    var result=JSON.parse(rows[0].result_json);
    if(result.success!==true||result.order_id!==r.order_id)throw Error('INVALID_SALE_RESULT');
    return Object.assign({},result,{verified:true});
  }catch(e){return {success:false,code:e.message,do_not_retry:true};}
  finally{if(locked)store.unlock();}
}
function brewSaleArgs_(args){
  try {
    var r=brewSaleRequest_(args);
    return BrewSaleCommit.execute(r,brewSaleStore_(),{build:function(request,snapshot){
      var result=brewSalePrepareCore_(request.customer,request.room,request.pickup,request.note,JSON.stringify(request.items),request.grand,request.order_id,request.datetime,request.discount?JSON.stringify(request.discount):'',request.payment,snapshot);
      if(!result||result.success!==true)throw Error(result&&(result.error||result.code)||'SALE_VALIDATION_FAILED');
      var plan=result._sale;if(!plan)throw Error('SALE_PREPARATION_MISSING');delete result._sale;plan.result=result;
      if(request.customer_id){
        var customers=brewRecipeTable_(snapshot.ss,'customers').rows.filter(function(c){return String(c.customer_id||'').trim()===request.customer_id;});
        if(customers.length!==1||isTrue(customers[0].is_deleted)||isFalse(customers[0].is_active))throw Error('CUSTOMER_NOT_AVAILABLE');
        var customer=customers[0],brand=String(customer.brand_id||'SHARED').trim().toUpperCase(),name=String(customer.full_name||customer.name||'').trim();
        if(!name)throw Error('CUSTOMER_NAME_MISSING');
        if(!['SHARED','ALL','HH','BB'].includes(brand))throw Error('CUSTOMER_BRAND_INVALID');
        plan.rows.orders.forEach(function(row){if(!['SHARED','ALL'].includes(brand)&&row[1]!==brand)throw Error('CUSTOMER_BRAND_MISMATCH');row[6]=request.customer_id;row[7]=name;});
      }
      return plan;
    }});
  }catch(e){return {success:false,error:e.message,code:'SALE_VALIDATION_FAILED',do_not_retry:false,result_unknown:false};}
}
