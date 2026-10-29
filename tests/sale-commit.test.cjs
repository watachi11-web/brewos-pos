const {test}=require('node:test'),assert=require('node:assert/strict');
const {execute,canonical}=require('../backend/sale-commit');
function fixture(){
 const state={held:false,fence:null,rows:[],stock:20,orders:[],commits:0,mode:''};
 const store={
  lock(){if(state.held)return false;state.held=true;return true;},unlock(){state.held=false;},
  assertNoRefundPending(){if(state.mode==='refund')throw Error('REFUND_RECONCILIATION_REQUIRED');},
  readFence(){return state.fence;},setFence(f){state.fence=f;if(state.mode==='fenceLost')throw Error('lost response');},
  clearFence(id,fp){assert.equal(state.fence.order_id,id);assert.equal(state.fence.fingerprint,fp);state.fence=null;},
  readCommitted(id){if(state.mode==='readLost'&&state.commits)throw Error('read unavailable');return state.rows.filter(r=>r.order_id===id);},
  hasLegacyOrder(id){return state.orders.includes(id);},snapshot(){return {stock:state.stock};},
  prepare(plan,fingerprint){if(state.mode==='schema')throw Error('SCHEMA_MISSING');return {plan,fingerprint};},
  commit({plan,fingerprint}){
   assert(state.held&&state.fence);state.commits++;
   if(state.mode==='reject')throw Error('atomic rejection');
   state.stock=plan.stock;state.orders.push(plan.result.order_id);
   state.rows.push({order_id:plan.result.order_id,status:'committed',fingerprint,result_json:JSON.stringify(plan.result)});
   if(state.mode==='commitLost')throw Error('lost response');
  }
 };
 const request={order_id:'RCP-TEST-123',items:[{id:'PRD-001',qty:1,price:30}],payment_method:'qr'};
 const planner={build(r,s){return {stock:s.stock-3,result:{success:true,order_id:r.order_id,grand:30}};}};
 return {state,store,request,planner,run:()=>execute(request,store,planner)};
}
test('sale and stock share one commit and an identical retry makes no second write',()=>{
 const h=fixture();assert.equal(h.run().success,true);assert.equal(h.state.stock,17);assert.equal(h.state.commits,1);assert.equal(h.state.fence,null);
 assert.equal(h.run().idempotent,true);assert.equal(h.state.commits,1);
});
test('different items with the same amount cannot reuse a committed receipt',()=>{
 const h=fixture();h.run();h.request.items[0].id='PRD-002';assert.equal(h.run().code,'ORDER_ID_COLLISION');assert.equal(h.state.commits,1);
});
test('lost atomic response recovers only from exact committed journal',()=>{
 const h=fixture();h.state.mode='commitLost';assert.equal(h.run().code,'SALE_RESULT_UNKNOWN');assert(h.state.fence);assert.equal(h.state.stock,17);
 h.state.mode='';assert.equal(h.run().idempotent,true);assert.equal(h.state.fence,null);assert.equal(h.state.commits,1);
});
test('absent row after rejection never permits automatic replay or a new ID',()=>{
 const h=fixture();h.state.mode='reject';assert.equal(h.run().result_unknown,true);assert.equal(h.state.stock,20);assert.deepEqual(h.state.rows,[]);
 h.state.mode='';assert.equal(h.run().code,'SALE_RECONCILIATION_REQUIRED');h.request.order_id='RCP-OTHER-123';assert.equal(h.run().code,'SALE_RECONCILIATION_REQUIRED');assert.equal(h.state.commits,1);
});
test('lost fence acknowledgment stops before any business writes',()=>{
 const h=fixture();h.state.mode='fenceLost';assert.equal(h.run().result_unknown,true);assert.equal(h.state.commits,0);
 h.state.mode='';assert.equal(h.run().code,'SALE_RECONCILIATION_REQUIRED');assert.equal(h.state.commits,0);
});
test('failed commit read-back preserves the fence until authoritative evidence returns',()=>{
 const h=fixture();h.state.mode='readLost';assert.equal(h.run().code,'SALE_RESULT_UNKNOWN');assert(h.state.fence);
 h.state.mode='';assert.equal(h.run().idempotent,true);assert.equal(h.state.commits,1);
});
test('schema failure and pending refund cause no reservation or stock writes',()=>{
 for(const mode of ['schema','refund']){const h=fixture();h.state.mode=mode;assert.equal(h.run().success,false);assert.equal(h.state.fence,null);assert.equal(h.state.commits,0);assert.equal(h.state.held,false);}
});
test('legacy receipt is not declared successful from matching totals',()=>{
 const h=fixture();h.state.orders.push(h.request.order_id);assert.equal(h.run().code,'LEGACY_ORDER_REQUIRES_VERIFICATION');assert.equal(h.state.commits,0);
});
test('canonical fingerprints ignore key order but preserve option and amount changes',()=>{
 assert.equal(canonical({b:1,a:{d:2,c:3}}),canonical({a:{c:3,d:2},b:1}));
 assert.notEqual(canonical({qty:1}),canonical({qty:2}));
 for(const x of [undefined,NaN,Infinity,new Date(),{a:undefined}])assert.throws(()=>canonical(x));
});
test('missing client receipt ID and lock contention are explicit no-write failures',()=>{
 const h=fixture();delete h.request.order_id;assert.equal(h.run().code,'CLIENT_ORDER_ID_REQUIRED');assert.equal(h.state.commits,0);
 const busy=fixture();busy.state.held=true;assert.equal(busy.run().code,'WRITE_LOCK_TIMEOUT');assert.equal(busy.state.held,true);
});
