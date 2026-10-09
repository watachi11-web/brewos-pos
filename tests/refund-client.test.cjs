const {test}=require('node:test'),assert=require('node:assert/strict');
const Client=require('../refund-client');
function harness(){
 const values=new Map(),calls=[];let serial=Promise.resolve(),sequence=0;
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const api={refundPreview:async r=>({success:true,plan:{...r}}),refundOrder:async r=>{calls.push(r);return {...r,success:true};},refundStatus:async id=>({...JSON.parse(storage.getItem(Client.KEY)),success:true,verified:true})};
 const locks={request(_key,_options,fn){const next=serial.then(fn);serial=next.catch(()=>{});return next;}};
 return {api,storage,calls,values,client:Client.create(api,storage,locks,()=>String(++sequence).padStart(8,'0'))};
}
test('preview never writes business data, commit stores intent before POST and clears verified success',async()=>{
 const h=harness(),p=await h.client.preview('O1','prepared','reason');assert.equal(h.values.size,0);
 h.api.refundOrder=async r=>{assert.deepEqual(h.client.pending(),r);return {...r,success:true};};
 await h.client.commit(p);assert.equal(h.client.pending(),null);
});
test('lost response survives reload and blocks subsequent previews/POSTs',async()=>{
 const h=harness(),p=await h.client.preview('O1','prepared','reason');
 h.api.refundOrder=async()=>{throw Error('network lost');};
 await assert.rejects(h.client.commit(p),/network/);assert.equal(h.client.pending().order_id,'O1');
 await assert.rejects(h.client.preview('O2','prepared','reason'),/รอตรวจ/);
 await assert.rejects(h.client.commit(p),/ห้ามส่ง/);
});
test('unknown or absent status NEVER replays a POST or clears intent',async()=>{
 const h=harness(),p=await h.client.preview('O1','prepared','reason');h.api.refundOrder=async()=>{throw Error('timeout');};
 await assert.rejects(h.client.commit(p));h.api.refundStatus=async()=>({success:false});
 h.api.refundOrder=async()=>{throw Error('MUST NOT CALL');};await assert.rejects(h.client.recover(),/ยืนยันผลไม่ได้/);assert.ok(h.client.pending());
});
test('only verified committed status permits exact idempotent acknowledgment',async()=>{
 const h=harness(),p=await h.client.preview('O1','prepared','reason');h.api.refundOrder=async()=>{throw Error('timeout');};await assert.rejects(h.client.commit(p));
 h.api.refundOrder=async r=>{assert.deepEqual(r,p.request);return {...r,success:true,idempotent:true};};
 await h.client.recover();assert.equal(h.client.pending(),null);
});
test('storage denial or missing cross-tab locks fails before sending',async()=>{
 const h=harness(),p=await h.client.preview('O1','prepared','reason');h.storage.setItem=()=>{throw Error('quota');};
 await assert.rejects(h.client.commit(p),/quota/);assert.equal(h.calls.length,0);
 const unsupported=Client.create(h.api,h.storage,null,()=> '12345678');await assert.rejects(unsupported.commit(p),/เบราว์เซอร์/);assert.equal(h.calls.length,0);
});
test('definite validation failure is retryable; malformed response remains pending',async()=>{
 const h=harness(),p=await h.client.preview('O1','prepared','reason');h.api.refundOrder=async()=>({success:false,code:'DAY_CLOSED',do_not_retry:false,stock_may_have_changed:false});
 await assert.rejects(h.client.commit(p),/DAY_CLOSED/);assert.equal(h.client.pending(),null);
 h.api.refundOrder=async()=>({success:true,operation_id:'wrong',order_id:'O1'});await assert.rejects(h.client.commit(p));assert.ok(h.client.pending());
});
test('simultaneous tab submissions cannot overwrite an unresolved intent',async()=>{
 const h=harness(),p=await h.client.preview('O1','prepared','reason');let writes=0;
 h.api.refundOrder=async()=>{writes++;throw Error('lost');};
 const results=await Promise.allSettled([h.client.commit(p),h.client.commit(p)]);assert.equal(writes,1);assert.ok(results.every(r=>r.status==='rejected'));
});
