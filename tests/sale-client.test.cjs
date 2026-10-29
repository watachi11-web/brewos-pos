const {test}=require('node:test'),assert=require('node:assert/strict'),Client=require('../sale-client');
function setup(){
 const values=new Map();let serial=Promise.resolve(),writes=0;
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const locks={request(k,o,fn){const next=serial.then(fn);serial=next.catch(()=>{});return next;}};
 const api={submitOrder:async p=>{writes++;return {success:true,order_id:p.receipt_id};},saleStatus:async p=>({success:true,verified:true,order_id:p.receipt_id})};
 const request={receipt_id:'RCP-TEST-123',items:[{id:'PRD-001',qty:2}],grand:60},receipt={grand:60};
 return {api,storage,locks,request,receipt,client:Client.create(api,storage,locks),writes:()=>writes};
}
test('sale intent and receipt are durable before the only POST; matched success clears it',async()=>{
 const h=setup();h.api.submitOrder=async p=>{assert.deepEqual(h.client.pending(),{request:p,receipt:h.receipt});return {success:true,order_id:p.receipt_id};};
 const r=await h.client.commit(h.request,h.receipt);assert.deepEqual(r.receipt,h.receipt);assert.equal(h.client.pending(),null);
});
test('lost sale response persists across reload and blocks another sale',async()=>{
 const h=setup();let calls=0;h.api.submitOrder=async()=>{calls++;throw Error('network');};
 await assert.rejects(h.client.commit(h.request,h.receipt));const reloaded=Client.create(h.api,h.storage,h.locks);
 await assert.rejects(reloaded.commit({...h.request,receipt_id:'RCP-NEXT'},h.receipt),/รอตรวจสอบ/);assert.equal(calls,1);assert.ok(reloaded.pending());
});
test('absent, mismatched or unverified journal never permits a second POST',async()=>{
 for(const status of [{success:false},{success:true,order_id:'wrong',verified:true},{success:true,order_id:'RCP-TEST-123'}]){
  const h=setup();h.api.submitOrder=async()=>{throw Error('timeout');};await assert.rejects(h.client.commit(h.request,h.receipt));
  h.api.saleStatus=async()=>status;h.api.submitOrder=async()=>assert.fail('must not POST');await assert.rejects(h.client.recover());assert.ok(h.client.pending());
 }
});
test('recovery acknowledges only the exact verified journal; requires idempotent result',async()=>{
 const h=setup();h.api.submitOrder=async()=>{throw Error('timeout');};await assert.rejects(h.client.commit(h.request,h.receipt));
 h.api.submitOrder=async p=>{assert.deepEqual(p,h.request);return {success:true,order_id:p.receipt_id};};await assert.rejects(h.client.recover());assert.ok(h.client.pending());
 h.api.submitOrder=async p=>({success:true,order_id:p.receipt_id,idempotent:true});assert.deepEqual((await h.client.recover()).receipt,h.receipt);assert.equal(h.client.pending(),null);
});
test('only proven no-write failures clear intent; malformed success stays pending',async()=>{
 const h=setup();h.api.submitOrder=async()=>({success:false,code:'DAY_CLOSED',do_not_retry:false,result_unknown:false});await assert.rejects(h.client.commit(h.request,h.receipt));assert.equal(h.client.pending(),null);
 h.api.submitOrder=async()=>({success:true,order_id:'wrong'});await assert.rejects(h.client.commit(h.request,h.receipt));assert.ok(h.client.pending());
});
test('storage failure and unsupported locks fail before any sale',async()=>{
 const h=setup();h.storage.setItem=()=>{throw Error('quota');};await assert.rejects(h.client.commit(h.request,h.receipt),/quota/);assert.equal(h.writes(),0);
 await assert.rejects(Client.create(h.api,h.storage,null).commit(h.request,h.receipt),/เบราว์เซอร์/);assert.equal(h.writes(),0);
});
test('two tabs cannot overwrite an uncertain sale intent',async()=>{
 const h=setup();let calls=0;h.api.submitOrder=async()=>{calls++;throw Error('lost');};
 const other=Client.create(h.api,h.storage,h.locks);await Promise.allSettled([h.client.commit(h.request,h.receipt),other.commit({...h.request,receipt_id:'RCP-NEXT'},h.receipt)]);assert.equal(calls,1);
});
test('a storage error after server success retains the pending request for verified recovery',async()=>{
 const h=setup(),set=h.storage.setItem;h.storage.setItem=(k,v)=>{if(k===Client.COMPLETED_KEY)throw Error('quota');set(k,v);};
 await assert.rejects(h.client.commit(h.request,h.receipt),/quota/);assert.ok(h.client.pending());assert.equal(h.writes(),1);
});
