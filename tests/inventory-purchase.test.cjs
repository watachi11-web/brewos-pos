const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../inventory.html'),'utf8');
const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n').replace("document.getElementById('rDate').value=todayBkk();addPurchaseLine();reloadAll();",'');
function setup(response,stored=null){
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],{value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,classList:{remove(){}}}]));
  elements.get('rDate').value='2026-10-04';elements.get('rPayment').value='cash';
  const storage=new Map(stored?[['brewos.purchase.pending.v1',stored]]:[]),calls=[];
  let lockHeld=false;
  const context=vm.createContext({URL,Intl,Date,AbortSignal,console,crypto:{randomUUID:()=> 'test-id'},setTimeout(){},window:{addEventListener(){}},
    navigator:{locks:{async request(_key,_options,fn){if(lockHeld)return fn(null);lockHeld=true;try{return await fn({});}finally{lockHeld=false;}}}},
    document:{getElementById:id=>elements.get(id),querySelectorAll:()=>[]},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    fetch:async(url,opts)=>{calls.push({url,opts});if(typeof response==='function')return response(url,opts);return {ok:true,json:async()=>response};}
  });
  const run=c=>vm.runInContext(c,context);run(source);run("ING=[{ingredient_id:'ING-001',unit:'g'}];purchaseLines=[{ingredient_id:'ING-001',purchase_qty:1,pack_size:100,pack_unit:'g',price_per_pack:10}];reloadAll=async()=>{};");
  return {run,context,calls,storage,el:id=>elements.get(id)};
}
const success={success:true,data:{success:true,receipt_id:'PUR-WEB-test-id',expense_id:'EXP-TEST',total_amount:10}};
test('valid receipt requires linked expense before clearing form and pending record',async()=>{
  const p=setup(success);await p.run('submitPurchase()');assert.equal(p.calls.length,1);assert.equal(p.storage.size,0);assert.equal(p.el('receiveBtn').disabled,false);assert.match(p.el('purchaseStatus').textContent,/EXP-TEST/);
  assert.equal(JSON.parse(p.calls[0].opts.body).receipt_id,'PUR-WEB-test-id');
});
test('nested failure, missing expense, malformed response and network failure remain locked across reload',async()=>{
  for(const response of [{success:true,data:{success:false,error:'expense failed'}},{success:true,data:{success:true,receipt_id:'PUR-WEB-test-id',expense_id:null,total_amount:10}},async()=>{throw Error('network lost');},{success:true,data:null}]){
    const p=setup(response);await p.run('submitPurchase()');assert.equal(p.el('receiveBtn').disabled,true);assert.equal(p.storage.size,1);await p.run('submitPurchase()');assert.equal(p.calls.length,1);
    const next=setup(success,[...p.storage.values()][0]);assert.equal(next.el('receiveBtn').disabled,true);await next.run('submitPurchase()');assert.equal(next.calls.length,0);
  }
});
test('double click while request in flight sends once',async()=>{
  let resolve;const p=setup(()=>new Promise(r=>{resolve=r;}));const first=p.run('submitPurchase()');await p.run('submitPurchase()');assert.equal(p.calls.length,1);resolve({ok:true,json:async()=>success});await first;
});
test('backend explicit no-write rejection allows corrected submission',async()=>{
  const p=setup({success:false,error:'closed',data:{success:false,stock_may_have_changed:false,do_not_retry:false}});await p.run('submitPurchase()');assert.equal(p.storage.size,0);assert.equal(p.el('receiveBtn').disabled,false);
});
test('verification only reads and unlocks after matching posted INVENTORY expense',async()=>{
  const pending=JSON.stringify({receipt_id:'PUR-OLD',date:'2026-10-04',payment_method:'cash'});
  const p=setup(async url=>({ok:true,json:async()=>({success:true,data:String(url).includes('get_expenses')?[{source_ref:'PUR-OLD',expense_id:'EXP-OLD',status:'posted',expense_type:'INVENTORY',category:'inventory_purchase',date:'2026-10-04',payment_method:'cash',amount:10}]:[{receipt_id:'PUR-OLD',status:'received',date:'2026-10-04',total_amount:10}]})}),pending);
  await p.run('verifyPendingPurchase()');assert.equal(p.storage.size,0);assert.equal(p.calls.length,2);assert.ok(p.calls.every(c=>!c.opts?.method));
});
test('unresolved read-back never resends or clears pending record',async()=>{
  const p=setup({success:true,data:[]},JSON.stringify({receipt_id:'PUR-OLD',date:'2026-10-04',payment_method:'cash'}));await p.run('verifyPendingPurchase()');assert.equal(p.storage.size,1);assert.equal(p.el('receiveBtn').disabled,true);assert.ok(p.calls.every(c=>!c.opts?.method));
});
test('storage failure and invalid input prevent every POST',async()=>{
  const p=setup(success);p.context.localStorage.setItem=()=>{throw Error('disk full');};await p.run('submitPurchase()');assert.equal(p.calls.length,0);
  const q=setup(success);q.run('purchaseLines[0].pack_size=-1');await q.run('submitPurchase()');assert.equal(q.calls.length,0);
});
