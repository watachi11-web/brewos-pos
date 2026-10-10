// Shared by deployed HTTP routes AND hosted google.script.run entry points.
// Native locks are not reentrant; only this execution-local adapter is nested.
var brewRefundLockState_;
function brewRefundSharedLock_() {
  if (!brewRefundLockState_) brewRefundLockState_={native:LockService.getScriptLock(),depth:0};
  var state=brewRefundLockState_,held=false;
  return {
    tryLock:function(ms){
      if(held)return true;
      if(state.depth===0&&!state.native.tryLock(ms))return false;
      state.depth++;held=true;return true;
    },
    releaseLock:function(){
      if(!held)return;
      held=false;state.depth--;
      if(state.depth===0){delete state.operations;state.native.releaseLock();}
    }
  };
}

function brewRefundOperations_() {
  var state=brewRefundLockState_;
  if(!state||!state.depth)return brewRefundStore_().readOperations();
  if(!state.operations)state.operations=brewRefundStore_().readOperations();
  return state.operations;
}

function brewRefundWithSnapshot_(fn) {
  var lock=brewRefundSharedLock_();
  if(!lock.tryLock(CONFIG.WRITE_LOCK_TIMEOUT_MS||30000))throw Error('WRITE_LOCK_TIMEOUT');
  try {
    brewRefundAssertNoPending_();
    return fn();
  } finally {lock.releaseLock();}
}

function brewRefundCost_(from,to,brand) {
  return brewRefundProjection_(from,to,brand).consumed_cost;
}

function brewRefundPreview_(params) {
  if(!brewRefundEnabled_())return {success:false,code:'REFUNDS_NOT_ENABLED'};
  return brewRefundWithSnapshot_(function(){
    var request=BrewRefundCommit.normalize(params),store=brewRefundStore_();
    var snapshot=store.snapshot();snapshot.operations=store.readOperations();
    var plan=BrewRefundPlan.build(request,snapshot);
    return {success:true,plan:plan,preview_only:true};
  });
}

// Read-only resolution. Absence is never a reason to resubmit or clear a fence.
function brewRefundStatus_(params) {
  var id=String((params||{}).operation_id||'');
  if(!/^RFD-[A-Za-z0-9-]{8,100}$/.test(id))throw Error('INVALID_OPERATION_ID');
  var lock=brewRefundSharedLock_();
  if(!lock.tryLock(30000))throw Error('WRITE_LOCK_TIMEOUT');
  try {
    var store=brewRefundStore_(),rows=store.readOperations().filter(function(r){return r.operation_id===id;});
    if(rows.length!==1||rows[0].status!=='committed')return {success:false,code:'REFUND_RECONCILIATION_REQUIRED',do_not_retry:true};
    var result=JSON.parse(rows[0].result_json);
    if(result.success!==true||result.operation_id!==id||result.order_id!==rows[0].order_id)throw Error('INVALID_REFUND_RESULT');
    // No writes, including no fence clearing, in a GET/status route.
    return Object.assign({},result,{verified:true});
  } finally {lock.releaseLock();}
}

// One locked snapshot avoids a refund committing between sales and cost reads.
function getRefundAwareReport(params) {
  params=params||{};
  return brewRefundWithSnapshot_(function(){
    var from=normalizeDateKey_(params.date_from)||'1900-01-01';
    var to=normalizeDateKey_(params.date_to)||dailyCloseToday_();
    var orders=getOrdersFromSheet(Object.assign({},params,{limit:5000}));
    if(orders.length>=5000)throw Error('REPORT_RANGE_TOO_LARGE: กรุณาลดช่วงวันที่');
    var ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID),rows=[];
    if(ss.getSheetByName('refund_operations')) {
      var ops=brewRefundStore_().readOperations();
      BrewRefundReport.sum(ops,from,to,'ALL'); // validate before projecting
      ops.filter(function(o){return o.business_date>=from&&o.business_date<=to;}).forEach(function(o){
        var plan=JSON.parse(o.plan_json);
        Object.keys(plan.accounting.by_brand).forEach(function(brand){
          var loss=plan.accounting.by_brand[brand].consumed_cost;
          if(loss>0&&(!params.brand_id||params.brand_id==='ALL'||params.brand_id===brand))rows.push({date_key:o.business_date,brand_id:brand,operation_id:o.operation_id,order_id:o.order_id,consumed_cost:loss});
        });
      });
    }
    return {orders:orders,refund_cost_rows:rows};
  });
}

// Deliberately retire the unsafe current-recipe restock route when activated.
// Old browser tabs get a clear failure, never an automatic prepared-stock return.
function cancelOrder(params) {
  return {success:false,code:'USE_REFUND_FLOW',error:'กรุณารีเฟรชหน้า Orders และใช้ขั้นตอนคืนเงินใหม่'};
}
