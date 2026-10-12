const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../inventory.html'),'utf8');
const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n').replace("document.getElementById('rDate').value=todayBkk();addPurchaseLine();reloadAll();",'');
function setup(answers=[],options={}){
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],{value:'',textContent:'',innerHTML:'',style:{},classList:{remove(){}}}]));
  const calls=[],prompts=[],confirmations=[],buttons=[];let refreshes=0;
  const context=vm.createContext({URL,Intl,Date,AbortSignal,console,setTimeout(){},window:{addEventListener(){}},
    document:{getElementById:id=>elements.get(id),querySelectorAll:s=>s==='#stockBody button[data-stock-action]'?buttons:[]},
    localStorage:{getItem:()=>null},prompt:(...args)=>{prompts.push(args);return answers.shift();},
    confirm:message=>{confirmations.push(message);return options.confirm!==false;},
    fetch:async(url,opts)=>{calls.push({url,opts});if(options.fetch)return options.fetch(url,opts);return {ok:true,json:async()=>({success:true,data:{success:true}})};}
  });
  const run=c=>vm.runInContext(c,context);run(source);run("ING=[{ingredient_id:'I1',name:'นม',unit:'g',current_stock:100,unit_cost:2}]");
  context.refreshed=()=>refreshes++;run('reloadAll=async()=>refreshed()');
  return {run,context,calls,prompts,confirmations,buttons,el:id=>elements.get(id),refreshes:()=>refreshes};
}
test('blank stocktake is never interpreted as zero; invalid inputs make no POST',async()=>{
  for(const value of ['', '  ', '-1', 'Infinity', 'NaN', '1,000']){
    const p=setup([value]);await p.run("stocktake('I1')");
    assert.equal(p.calls.length,0);assert.equal(p.confirmations.length,0);assert.equal(p.run('stockWriteBusy'),false);
  }
});
test('cancel at quantity, reason or review stops both stock actions without writes',async()=>{
  for(const fn of ['stocktake','adjust'])for(const [answers,confirm]of [[[null],true],[['5',null],true],[['5','checked'],false]]){
    const p=setup(answers,{confirm});await p.run(fn+"('I1')");assert.equal(p.calls.length,0);assert.equal(p.refreshes(),0);assert.equal(p.run('stockWriteBusy'),false);
  }
});
test('empty reasons are not replaced with a default or submitted',async()=>{
  for(const fn of ['stocktake','adjust'])for(const note of ['', '  ']){
    const p=setup(['5',note]);await p.run(fn+"('I1')");assert.equal(p.calls.length,0);assert.equal(p.confirmations.length,0);
  }
});
test('explicit zero stock requires review and retains the original backend payload',async()=>{
  const p=setup(['0','  หมดจริง  ']);await p.run("stocktake('I1')");
  assert.equal(p.calls.length,1);assert.deepEqual(JSON.parse(p.calls[0].opts.body),{action:'stocktake',ingredient_id:'I1',counted_qty:0,reason:'หมดจริง'});
  assert.match(p.confirmations[0],/ยอดเดิมที่โหลด: 100/);assert.match(p.confirmations[0],/ยอดใหม่: 0/);assert.match(p.confirmations[0],/ส่วนต่าง: -100/);assert.match(p.confirmations[0],/ยอดใหม่เป็นศูนย์/);assert.equal(p.refreshes(),1);
});
test('fractional counts are not rounded in confirmation or POST',async()=>{
  const p=setup(['0.0001','counted']);await p.run("stocktake('I1')");assert.match(p.confirmations[0],/ยอดใหม่: 0.0001/);assert.equal(JSON.parse(p.calls[0].opts.body).counted_qty,0.0001);
});
test('delta review preserves add/subtract semantics and warns without clamping negatives',async()=>{
  for(const value of ['+5','-110']){
    const p=setup([value,'waste']);await p.run("adjust('I1')");const body=JSON.parse(p.calls[0].opts.body);
    assert.equal(body.action,'adjust_stock');assert.equal(body.adjust_type,value[0]==='+'?'add':'subtract');assert.equal(body.amount,Math.abs(Number(value)));
    assert.match(p.confirmations[0],/ยอดใหม่โดยประมาณ:/);if(value==='-110')assert.match(p.confirmations[0],/ยอดใหม่ติดลบ/);
  }
});
test('missing baseline, invalid delta and overflow fail before POST',async()=>{
  for(const expr of ["ING=[]","ING[0].current_stock=''","ING[0].current_stock=null","ING[0].current_stock=NaN","ING[0].unit=''" ]){
    const p=setup(['5','test']);p.run(expr);await p.run("stocktake('I1')");assert.equal(p.calls.length,0);assert.equal(p.prompts.length,0);
  }
  for(const value of ['', '0', 'Infinity']){const p=setup([value,'test']);await p.run("adjust('I1')");assert.equal(p.calls.length,0);}
  const p=setup(['1.7e308','test']);p.run('ING[0].current_stock=1.7e308');await p.run("adjust('I1')");assert.equal(p.calls.length,0);
});
test('both stock actions are single-flight until response and refresh finish',async()=>{
  let finish;const p=setup(['5','counted'],{fetch:()=>new Promise(r=>finish=r)});p.buttons.push({});
  const first=p.run("stocktake('I1')");await p.run("adjust('I1')");await p.run("stocktake('I1')");
  assert.equal(p.calls.length,1);assert.equal(p.prompts.length,2);assert.equal(p.buttons[0].disabled,true);
  finish({ok:true,json:async()=>({success:true,data:{success:true}})});await first;assert.equal(p.buttons[0].disabled,false);
});
test('unknown response is not retried or shown as success',async()=>{
  for(const fetch of [async()=>{throw Error('lost response');},async()=>({ok:true,json:async()=>({success:true,data:null})}),async()=>({ok:true,json:async()=>({success:true,data:{success:false,error:'closed'}})})]){
    const p=setup(['5','counted'],{fetch});await p.run("stocktake('I1')");assert.equal(p.calls.length,1);assert.equal(p.refreshes(),0);assert.match(p.el('toast').textContent,/ห้ามส่งซ้ำ/);
  }
});
const hostile=`x'\"><img src=x onerror=alert(1)>&`;
test('stock names, IDs, units, categories and button attributes are escaped, not inline JS',()=>{
  const p=setup();p.context.hostile=hostile;p.run('ING=[{ingredient_id:hostile,name:hostile,unit:hostile,category:hostile,current_stock:100}];renderStock()');
  const out=p.el('stockBody').innerHTML;assert.ok(!out.includes('<img'));assert.ok(!out.includes('onclick='));assert.ok(out.includes('&lt;img'));assert.ok(out.includes('&quot;'));assert.ok(out.includes('&#39;'));assert.ok(out.includes('data-ingredient-id='));
});
test('stock button passes the unchanged data ID through a function handler',async()=>{
  const p=setup(['5','checked']);p.context.hostile=hostile;p.run('ING[0].ingredient_id=hostile');
  const button={dataset:{stockAction:'count',ingredientId:hostile}};p.buttons.push(button);p.run('renderStock()');await button.onclick();
  assert.equal(JSON.parse(p.calls[0].opts.body).ingredient_id,hostile);
});
test('supplier, ingredient options, units and purchase input values escape every data field',()=>{
  const p=setup();p.context.hostile=hostile;p.run('SUP=[{supplier_id:hostile,company_name:hostile}];supplierOptions();ING=[{ingredient_id:hostile,name:hostile,unit:hostile}];purchaseLines=[{ingredient_id:hostile,pack_unit:hostile,purchase_qty:hostile,pack_size:hostile,price_per_pack:hostile,line_discount:hostile}];renderPurchaseLines()');
  for(const id of ['rSupplier','purchaseBody']){const out=p.el(id).innerHTML;assert.ok(!out.includes('<img'));assert.ok(out.includes('&lt;img'));}
  assert.ok(p.el('purchaseBody').innerHTML.includes('&amp;" selected>'));
});
test('purchase receipts and transaction history render hostile values only as text',async()=>{
  const p=setup([],{fetch:async url=>({ok:true,json:async()=>({success:true,data:String(url).includes('get_purchase_receipts')?[{date:hostile,receipt_id:hostile,supplier_name:hostile,invoice_no:hostile}]:[{created_at:hostile,ingredient_id:hostile,txn_type:hostile,unit_type:hostile,source_doc_id:hostile}]})})});
  await p.run('loadHistory()');for(const id of ['receiptBody','txnBody']){assert.ok(!p.el(id).innerHTML.includes('<img'));assert.ok(p.el(id).innerHTML.includes('&lt;img'));}
});
