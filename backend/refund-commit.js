/* Server-only orchestration. No production route imports this staged module yet.
 * Store contract: every writer shares the lock; readOperations is authoritative;
 * reserve durably writes an intent; commit atomically writes ALL business changes
 * plus the committed result. An uncertain request is NEVER replayed automatically.
 */
var BrewRefundCommit = (function () {
  'use strict';
  function reject(code, uncertain) {
    return {success:false,code:code,do_not_retry:!!uncertain,stock_may_have_changed:!!uncertain};
  }
  function normalize(r) {
    r=r||{};
    var request={order_id:String(r.order_id||'').trim(),operation_id:String(r.operation_id||'').trim(),disposition:String(r.disposition||'').trim(),reason:String(r.reason||'').trim(),refund_confirmed:r.refund_confirmed===true};
    if(!request.order_id||!/^RFD-[A-Za-z0-9-]{8,100}$/.test(request.operation_id)||!request.reason||request.reason.length>500||['prepared','unprepared'].indexOf(request.disposition)<0||!request.refund_confirmed)throw Error('INVALID_REQUEST');
    return request;
  }
  function resultFor(plan) {
    return {success:true,operation_id:plan.operation_id,order_id:plan.order_id,order_ids:plan.order_ids,business_date:plan.business_date,disposition:plan.disposition,refund_amount:plan.refund_amount,refund_by_payment:plan.refund_by_payment,consumed_cost:plan.accounting.consumed_cost_retained,stock:plan.stock_moves,manual_refund_only:true};
  }
  function execute(raw, store, planner) {
    var request,locked=false,uncertain=false;
    try {
      request=normalize(raw);
      if(!store.lock())return reject('WRITE_LOCK_TIMEOUT',false);
      locked=true;
      // Canonical exact request is the fingerprint. No client totals or snapshot.
      var fingerprint=JSON.stringify(request),ops=store.readOperations(),fence=store.readFence();
      if(!Array.isArray(ops))throw Error('REFUND_STORE_UNAVAILABLE');
      var same=ops.filter(function(o){return o.operation_id===request.operation_id;});
      if(same.length>1)return reject('DUPLICATE_REFUND_RECORD',true);
      if(same.length){
        if(same[0].request_json!==fingerprint)return reject('OPERATION_ID_CONFLICT',true);
        if(same[0].status!=='committed')return reject('REFUND_RECONCILIATION_REQUIRED',true);
        var prior=JSON.parse(same[0].result_json);
        if(prior.success!==true||prior.operation_id!==request.operation_id||prior.order_id!==request.order_id)throw Error('INVALID_REFUND_RESULT');
        if(fence&&fence.operation_id===request.operation_id)store.clearFence(request.operation_id);
        return Object.assign({},prior,{idempotent:true});
      }
      // A reservation request might still reach Sheets after its client times out.
      // Absence of a row is NOT proof it failed. Persist this fence before sending.
      if(fence)return reject('REFUND_RECONCILIATION_REQUIRED',true);
      if(ops.some(function(o){return o.status!=='committed';}))return reject('REFUND_RECONCILIATION_REQUIRED',true);
      if(ops.some(function(o){return o.order_id===request.order_id;}))return reject('ALREADY_REFUNDED',false);
      var snapshot=store.snapshot();snapshot.operations=ops;
      var plan=planner.build(request,snapshot);
      var result=resultFor(plan);
      // Prepare validates all target schemas and cell types BEFORE reserving intent.
      var prepared=store.prepare(plan,result,fingerprint);
      uncertain=true;
      store.setFence({operation_id:plan.operation_id,order_id:plan.order_id,request_json:fingerprint,started_at_ms:Date.now()});
      store.reserve(plan,fingerprint);
      var reserved=store.readOperations().filter(function(o){return o.operation_id===plan.operation_id;});
      if(reserved.length!==1||reserved[0].status!=='pending'||reserved[0].request_json!==fingerprint)return reject('RESERVATION_NOT_VERIFIED',true);
      store.commit(prepared,reserved[0]);
      var committed=store.readOperations().filter(function(o){return o.operation_id===plan.operation_id;});
      if(committed.length!==1||committed[0].status!=='committed'||committed[0].request_json!==fingerprint||committed[0].result_json!==JSON.stringify(result))return reject('COMMIT_NOT_VERIFIED',true);
      store.clearFence(plan.operation_id);
      return result;
    } catch(e) {
      return reject(uncertain?'REFUND_RESULT_UNKNOWN':(e.code||e.message||'REFUND_FAILED'),uncertain);
    } finally { if(locked){try{store.unlock();}catch(_e){/* lock expiry remains the runtime fallback */}} }
  }
  // Editor-only recovery, never a browser/HTTP endpoint. An operator MUST verify
  // original executions are terminal and pause clients before calling. The wait
  // is an additional guard, not a substitute for checking execution history.
  function reconcile(store,planner,confirmation,now) {
    var locked=false;
    try {
      if(!store.lock())return reject('WRITE_LOCK_TIMEOUT',true);locked=true;
      var fence=store.readFence();
      if(!fence||confirmation!=='FINISH '+fence.operation_id+' EXECUTIONS TERMINAL AND POS PAUSED')return reject('OPERATOR_CONFIRMATION_REQUIRED',true);
      if(!Number.isFinite(fence.started_at_ms)||now-fence.started_at_ms<15*60*1000)return reject('RECOVERY_QUIET_PERIOD_REQUIRED',true);
      var request=normalize(JSON.parse(fence.request_json)),ops=store.readOperations();
      if(request.operation_id!==fence.operation_id||request.order_id!==fence.order_id)throw Error('FENCE_REQUEST_MISMATCH');
      var same=ops.filter(function(o){return o.operation_id===fence.operation_id;});
      if(same.length>1||ops.some(function(o){return o.operation_id!==fence.operation_id&&o.status!=='committed';}))throw Error('REFUND_RECORD_CONFLICT');
      if(same.length&&same[0].request_json!==fence.request_json)throw Error('OPERATION_ID_CONFLICT');
      if(same.length&&same[0].status==='committed'){
        var prior=JSON.parse(same[0].result_json);
        if(prior.success!==true||prior.operation_id!==fence.operation_id||prior.order_id!==fence.order_id)throw Error('INVALID_REFUND_RESULT');
        store.clearFence(fence.operation_id);return Object.assign({},prior,{idempotent:true});
      }
      if(same.length&&same[0].status!=='pending')throw Error('REFUND_RECORD_CONFLICT');
      var snapshot=store.snapshot();snapshot.operations=ops.filter(function(o){return o.operation_id!==fence.operation_id;});
      // Paid/open/same-day and no reversal must STILL be provable. A partially
      // altered or cross-day record requires a separately approved manual repair.
      var plan=planner.build(request,snapshot),result=resultFor(plan);
      if(same.length&&(same[0].plan_json!==JSON.stringify(plan)||same[0].result_json!==JSON.stringify(result)))throw Error('RECOVERY_SNAPSHOT_CHANGED');
      var prepared=store.prepare(plan,result,fence.request_json);
      if(!same.length)store.reserve(plan,fence.request_json);
      var reserved=store.readOperations().filter(function(o){return o.operation_id===plan.operation_id;});
      if(reserved.length!==1||reserved[0].status!=='pending'||reserved[0].request_json!==fence.request_json)throw Error('RESERVATION_NOT_VERIFIED');
      store.commit(prepared,reserved[0]);
      var committed=store.readOperations().filter(function(o){return o.operation_id===plan.operation_id;});
      if(committed.length!==1||committed[0].status!=='committed'||committed[0].result_json!==JSON.stringify(result)||committed[0].request_json!==fence.request_json)throw Error('COMMIT_NOT_VERIFIED');
      store.clearFence(plan.operation_id);return Object.assign({},result,{operator_reconciled:true});
    }catch(e){return reject(e.code||e.message||'REFUND_RECONCILIATION_REQUIRED',true);}
    finally{if(locked)store.unlock();}
  }
  return {execute:execute,normalize:normalize,reconcile:reconcile};
})();
if(typeof module==='object'&&module.exports)module.exports=BrewRefundCommit;
