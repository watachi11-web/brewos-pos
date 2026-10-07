const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../inventory.html'),'utf8');
const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n').replace("document.getElementById('rDate').value=todayBkk();addPurchaseLine();reloadAll();",'');
function setup(response,stored=null){
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],{value:'',textContent:'',innerHTML:'',disabled:false,hidden:false,classList:{remove(){}}}]));
  elements.get('rDate').value='2026-10-04';elements.get('rPayment').value='cash';
  const storage=new Map(stored?[['brewos.purchase.pending.v1',stored]]:[]),calls=[],confirmations=[];
  let lockHeld=false;
  const context=vm.createContext({URL,Intl,Date,AbortSignal,console,crypto:{randomUUID:()=> 'test-id'},setTimeout(){},window:{addEventListener(){}},
    confirm:message=>{confirmations.push(message);return true;},
    navigator:{locks:{async request(_key,_options,fn){if(lockHeld)return fn(null);lockHeld=true;try{return await fn({});}finally{lockHeld=false;}}}},
    document:{getElementById:id=>elements.get(id),querySelectorAll:()=>[]},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    fetch:async(url,opts)=>{calls.push({url,opts});if(typeof response==='function')return response(url,opts);return {ok:true,json:async()=>response};}
  });
  const run=c=>vm.runInContext(c,context);run(fs.readFileSync(path.join(__dirname,'../purchase-review.js'),'utf8'));run(source);run("ING=[{ingredient_id:'ING-001',unit:'g'}];purchaseLines=[{ingredient_id:'ING-001',purchase_qty:1,pack_size:100,pack_unit:'g',price_per_pack:10}];reloadAll=async()=>{};");
  context.document.querySelectorAll=selector=>selector==='#purchaseBody tr'?Array.from(run('purchaseLines'),l=>({querySelectorAll:tag=>(tag==='select'?[l.ingredient_id,l.pack_unit]:[l.purchase_qty,l.pack_size,l.price_per_pack,l.line_discount??0]).map(value=>({value:String(value)}))})):[];
  return {run,context,calls,storage,confirmations,el:id=>elements.get(id)};
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

test('declining purchase review writes nothing and preserves the form',async()=>{
  const p=setup(success);p.context.confirm=()=>false;await p.run('submitPurchase()');
  assert.equal(p.calls.length,0);assert.equal(p.storage.size,0);
  assert.equal(p.run('purchaseLines[0].pack_size'),100);assert.equal(p.el('receiveBtn').disabled,false);
  assert.match(p.el('purchaseStatus').textContent,/ยังไม่ได้ส่ง/);
});
test('purchase review displays full pack calculation before unchanged payload is sent',async()=>{
  const p=setup(success);await p.run('submitPurchase()');assert.equal(p.confirmations.length,1);
  assert.match(p.confirmations[0],/1 แพ็ก × 100 g = 100 g/);
  const body=JSON.parse(p.calls[0].opts.body);assert.equal(body.lines[0].pack_size,100);assert.equal(body.lines[0].price_per_pack,10);
});
test('negative factors and excessive discounts never reach confirmation or POST',async()=>{
  for(const change of ["purchaseLines[0].pack_size=-100;purchaseLines[0].purchase_qty=-1","purchaseLines[0].line_discount=11","document.getElementById('rDiscount').value='11'"]){
    const p=setup(success);p.run(change);await p.run('submitPurchase()');
    assert.equal(p.calls.length,0);assert.equal(p.confirmations.length,0);assert.equal(p.storage.size,0);
  }
});
test('confirmation and POST use visible fields even without a change event',async()=>{
  const p=setup(success);
  p.context.document.querySelectorAll=()=>[{querySelectorAll:tag=>(tag==='select'?['ING-001','g']:['4','165','37','0']).map(value=>({value}))}];
  await p.run('submitPurchase()');
  assert.match(p.confirmations[0],/4 แพ็ก × 165 g = 660 g/);
  const line=JSON.parse(p.calls[0].opts.body).lines[0];
  assert.equal(line.purchase_qty,4);assert.equal(line.pack_size,165);assert.equal(line.price_per_pack,37);
});
test('incomplete DOM or blank price never confirms or posts',async()=>{
  for(const mode of ['missing','blank']){
    const p=setup(success);p.context.document.querySelectorAll=()=>mode==='missing'?[]:[{querySelectorAll:tag=>(tag==='select'?['ING-001','g']:['4','165','','0']).map(value=>({value}))}];
    await p.run('submitPurchase()');assert.equal(p.calls.length,0);assert.equal(p.confirmations.length,0);assert.equal(p.storage.size,0);
  }
});
