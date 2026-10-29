/* Staged atomic-sale coordinator. No production route loads this module.
 * Store: shared lock + refund fence; authoritative journal reads; durable fence
 * BEFORE any business write; atomic commit includes the exact recorded result.
 * An absent journal after a timeout NEVER authorizes repeating the write.
 */
var BrewSaleCommit = (function () {
  'use strict';
  function fail(code,unknown){return {success:false,code:code,do_not_retry:!!unknown,result_unknown:!!unknown};}
  function canonical(v){
    if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
    if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
    if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
    if(v&&Object.getPrototypeOf(v)===Object.prototype)return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+canonical(v[k]);}).join(',')+'}';
    throw Error('INVALID_SALE_REQUEST');
  }
  function prior(store,id,fingerprint){
    var rows=store.readCommitted(id);
    if(!Array.isArray(rows)||rows.length>1)throw Error('INVALID_SALE_JOURNAL');
    if(!rows.length)return null;
    var row=rows[0];
    if(row.order_id!==id||row.status!=='committed')throw Error('SALE_RECONCILIATION_REQUIRED');
    if(row.fingerprint!==fingerprint)throw Error('ORDER_ID_COLLISION');
    var result=JSON.parse(row.result_json);
    if(result.success!==true||result.order_id!==id)throw Error('INVALID_SALE_RESULT');
    return result;
  }
  function execute(request,store,planner){
    var locked=false,unknown=false;
    try {
      if(!request||!/^RCP-[A-Za-z0-9_-]{2,116}$/.test(request.order_id||''))throw Error('CLIENT_ORDER_ID_REQUIRED');
      var encoded=canonical(request),fingerprint=store.fingerprint?store.fingerprint(encoded):encoded,id=request.order_id;
      if(!store.lock())return fail('WRITE_LOCK_TIMEOUT',false);
      locked=true;
      store.assertNoRefundPending();
      var fence=store.readFence();
      // A different in-flight sale blocks this request, including a retry of a
      // previous committed sale. Do not accidentally clear someone else's fence.
      if(fence&&(fence.order_id!==id||fence.fingerprint!==fingerprint))return fail('SALE_RECONCILIATION_REQUIRED',true);
      var old=prior(store,id,fingerprint);
      if(old){if(fence)store.clearFence(id,fingerprint);return Object.assign({},old,{idempotent:true});}
      if(fence)return fail('SALE_RECONCILIATION_REQUIRED',true);
      // Legacy paid records lack the exact fingerprint and may be partial.
      if(store.hasLegacyOrder(id))return fail('LEGACY_ORDER_REQUIRES_VERIFICATION',true);
      var snapshot=store.snapshot(),plan=planner.build(request,snapshot);
      if(!plan||!plan.result||plan.result.success!==true||plan.result.order_id!==id)throw Error('INVALID_SALE_PLAN');
      // Validate schemas, cell types and all mutations before reserving intent.
      var batch=store.prepare(plan,fingerprint);
      unknown=true;
      store.setFence({order_id:id,fingerprint:fingerprint,started_at_ms:Date.now()});
      var durable=store.readFence();
      if(!durable||durable.order_id!==id||durable.fingerprint!==fingerprint)throw Error('SALE_FENCE_NOT_VERIFIED');
      store.commit(batch);
      var result=prior(store,id,fingerprint);
      if(!result||canonical(result)!==canonical(plan.result))throw Error('SALE_COMMIT_NOT_VERIFIED');
      store.clearFence(id,fingerprint);
      return result;
    } catch(e) {return fail(unknown?'SALE_RESULT_UNKNOWN':e.message,unknown);}
    finally {if(locked){try{store.unlock();}catch(_e){/* native lock expires with execution */}}}
  }
  return {execute:execute,canonical:canonical};
}());
if(typeof module!=='undefined'&&module.exports)module.exports=BrewSaleCommit;
