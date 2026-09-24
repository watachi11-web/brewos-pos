// Run with: node --test tests/daily_close.test.cjs
// Executes the page's real inline script and api.js with a minimal DOM and mocked fetch.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'daily_close.html'),'utf8');
const inline=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
const api=fs.readFileSync(path.join(root,'api.js'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const preview=(date,extra={})=>({date,net_sales:123,cogs:23,gross_profit:100,net_profit:88.86,
  gross_sales:123,ticket_count:1,low_stock_count:0,negative_stock_count:0,unresolved_integrity_events:0,
  expected_payment:{cash:100,qr:23,transfer:0,other:0},close_status:'open',can_close:true,...extra});
const response=data=>({ok:true,json:async()=>({success:true,data})});

async function setup(handle=null){
  const elements=new Map();
  function element(id){
    let markup='',isHTML=false;
    const children=[];
    const el={value:'',disabled:false,style:{},className:'',listeners:{},
      addEventListener(type,fn){this.listeners[type]=fn;},
      insertAdjacentHTML(_position,text){markup=text+markup;}};
    function replace(value,parse){
      children.splice(0).forEach(child=>elements.delete(child));markup=String(value);isHTML=parse;
      if(parse)for(const match of markup.matchAll(/<input\b[^>]*id="([^"]+)"[^>]*>/g)){
        const child=element(match[1]);child.value=match[0].match(/value="([^"]*)"/)?.[1]||'';children.push(match[1]);
      }
    }
    Object.defineProperties(el,{
      innerHTML:{get:()=>isHTML?markup:markup.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),set:value=>replace(value,true)},
      textContent:{get:()=>isHTML?markup.replace(/<[^>]*>/g,''):markup,set:value=>replace(value,false)}
    });
    elements.set(id,el);return el;
  }
  for(const match of html.matchAll(/\bid="([^"]+)"/g))element(match[1]);
  const calls=[];
  const state={handle};
  const context=vm.createContext({console,URL,URLSearchParams,Intl,setTimeout,clearTimeout,
    Date:class extends Date{constructor(...args){super(...(args.length?args:['2026-09-24T05:00:00Z']));}},
    document:{getElementById:id=>elements.get(id)||null,createElement:()=>({}),head:{appendChild(){}}},
    window:{location:{search:''},scrollTo(){}},
    sessionStorage:{getItem:()=>null},prompt:()=> 'Test reason',
    fetch:async(url,options={})=>{
      const u=new URL(url),body=options.body?JSON.parse(options.body):null;
      const action=body?.action||u.searchParams.get('action'),date=body?.date||u.searchParams.get('date');
      const call={action,date,body,method:options.method||'GET'};calls.push(call);
      const custom=state.handle?await state.handle(call):undefined;
      if(custom!==undefined)return custom;
      if(action==='get_daily_close_preview')return response(preview(date));
      if(action==='get_day_lock_status')return response({date,status:'open',locked:false});
      if(action==='get_daily_closes')return response([]);
      if(action==='close_day'||action==='reopen_day')return response({success:true,close_id:'CLOSE-20260924',variance:{total:0}});
      throw new Error('Unexpected API call '+action);
    }});
  vm.runInContext(api,context);vm.runInContext(inline,context);
  await flush();
  return {state,calls,run:code=>vm.runInContext(code,context),el:id=>elements.get(id),
    reload:date=>{if(date!==undefined)elements.get('date').value=date;return vm.runInContext('loadPreview()',context);}};
}
function assertUnavailable(p){
  assert.equal(p.run('P'),null);assert.equal(p.run('LOCK'),null);
  assert.equal(p.el('closeBtn').disabled,true);assert.equal(p.el('reopenBtn').disabled,true);
  assert.equal(p.el('reopenBtn').style.display,'none');assert.equal(p.el('notes').disabled,true);
  assert.doesNotMatch(p.el('kpi').innerHTML,/฿/);assert.equal((p.el('kpi').innerHTML.match(/>—</g)||[]).length,8);
  assert.equal(p.el('a_cash'),undefined);assert.match(p.el('payments').textContent,/ยังไม่มีข้อมูล/);
}

test('HTTP 404 clears old amounts immediately, blocks writes and permits manual retry',async()=>{
  const p=await setup();assert.match(p.el('kpi').textContent,/123/);assert.equal(p.el('a_cash').value,'100');
  const pending=deferred();p.state.handle=c=>c.action==='get_daily_close_preview'?pending.promise:undefined;
  const loading=p.reload('2026-09-23');assertUnavailable(p);
  pending.resolve({ok:false,status:404});await loading;assertUnavailable(p);
  assert.match(p.el('status').textContent,/HTTP 404 · get_daily_close_preview/);
  assert.match(p.el('status').textContent,/2026-09-23/);
  await p.run('closeDay()');await p.run('reopenDay()');assert.equal(p.calls.filter(c=>c.method==='POST').length,0);
  p.state.handle=null;await p.reload();assert.equal(p.run('P.date'),'2026-09-23');assert.equal(p.el('closeBtn').disabled,false);
});

test('late history must not enable Reopen after a preview failure',async()=>{
  const p=await setup();p.state.handle=c=>c.action==='get_daily_close_preview'?{ok:false,status:404}:
    c.action==='get_daily_closes'?response([{close_id:'CLOSE-20260924',date:'2026-09-24',status:'closed'}]):undefined;
  await p.reload();await p.run('loadHistory()');assertUnavailable(p);
  await p.run('reopenDay()');assert.equal(p.calls.filter(c=>c.method==='POST').length,0);
});

for(const failure of [false,true])test('out-of-order preview '+(failure?'failure':'success')+' cannot replace latest date',async()=>{
  const p=await setup(),old=deferred();
  p.state.handle=c=>c.action==='get_daily_close_preview'&&c.date==='2026-09-22'?old.promise:undefined;
  const loading=p.reload('2026-09-22');await p.reload('2026-09-23');
  const status=p.el('status').textContent;
  old.resolve(failure?{ok:false,status:404}:response(preview('2026-09-22',{net_sales:999})));
  await loading;assert.equal(p.run('P.date'),'2026-09-23');assert.equal(p.el('status').textContent,status);
  assert.doesNotMatch(p.el('kpi').textContent,/999/);
  assert.equal(p.calls.some(c=>c.action==='get_day_lock_status'&&c.date==='2026-09-22'),false);
});

test('late lock response cannot mix dates or enable buttons while preview is incomplete',async()=>{
  const p=await setup(),old=deferred();
  p.state.handle=c=>c.action==='get_day_lock_status'&&c.date==='2026-09-22'?old.promise:undefined;
  const loading=p.reload('2026-09-22');await flush();assertUnavailable(p);
  await p.reload('2026-09-23');old.resolve(response({date:'2026-09-22',status:'closed',locked:true}));
  await loading;assert.equal(p.run('P.date'),'2026-09-23');assert.equal(p.run('LOCK.date'),'2026-09-23');
  assert.equal(p.el('closeBtn').disabled,false);
});

test('same-date refresh also rejects an older response',async()=>{
  const p=await setup(),old=deferred();let n=0;
  p.state.handle=c=>c.action==='get_daily_close_preview'&&++n===1?old.promise:undefined;
  const loading=p.reload();await p.reload();old.resolve(response(preview('2026-09-24',{net_sales:999})));
  await loading;assert.equal(p.run('P.net_sales'),123);
});

test('blank selection and mismatched preview date fail closed without invented zero totals',async()=>{
  const p=await setup(),count=p.calls.length;await p.reload('');assertUnavailable(p);assert.equal(p.calls.length,count);
  p.state.handle=c=>c.action==='get_daily_close_preview'?response(preview('2026-09-22')):undefined;
  await p.reload('2026-09-23');assertUnavailable(p);assert.match(p.el('status').textContent,/ไม่ตรง/);
});

test('existing preview-based lock fallback, closed-day history, holiday and integrity behavior remain',async()=>{
  const p=await setup();let data=preview('2026-09-24',{is_closed:true,close_status:'closed'});
  p.state.handle=c=>c.action==='get_daily_close_preview'?response(data):c.action==='get_day_lock_status'?{ok:false,status:404}:undefined;
  await p.reload();assert.equal(p.el('reopenBtn').style.display,'inline-block');assert.equal(p.el('closeBtn').disabled,true);
  data=preview('2026-09-24',{gross_sales:0,net_sales:0,ticket_count:0});await p.reload();
  assert.match(p.el('closeBtn').textContent,/วันหยุด/);assert.equal(p.el('closeBtn').disabled,false);
  data=preview('2026-09-24',{unresolved_integrity_events:1});await p.reload();assert.equal(p.el('closeBtn').disabled,true);
  data=preview('2026-09-24');await p.reload();
  p.run("CLOSES=[{close_id:'CLOSE-20260924',status:'closed'}];setButtons()");
  assert.equal(p.el('reopenBtn').style.display,'inline-block');
});

test('editing date without an event still prevents writes with the previous preview',async()=>{
  const p=await setup();p.el('date').value='2026-09-23';await p.run('closeDay()');await p.run('reopenDay()');
  assert.equal(p.calls.filter(c=>c.method==='POST').length,0);
});

test('valid close sends unchanged selected-date accounting payload (mock only)',async()=>{
  const p=await setup();p.el('a_cash').value='101.25';p.el('notes').value='Counted';await p.run('closeDay()');
  const writes=p.calls.filter(c=>c.method==='POST');assert.equal(writes.length,1);
  assert.deepEqual(writes[0].body,{action:'close_day',date:'2026-09-24',actual_cash:101.25,actual_qr:23,
    actual_transfer:0,actual_other:0,notes:'Counted',closed_by:'owner'});
});

test('history refresh never reloads preview or overwrites entered cash',async()=>{
  const p=await setup();const count=p.calls.filter(c=>c.action==='get_daily_close_preview').length;
  p.el('a_cash').value='150';await p.run('loadHistory()');assert.equal(p.el('a_cash').value,'150');
  assert.equal(p.calls.filter(c=>c.action==='get_daily_close_preview').length,count);
});

test('late startup history cannot launch a second preview or erase entered cash',async()=>{
  const history=deferred();
  const p=await setup(c=>c.action==='get_daily_closes'?history.promise:undefined);
  assertUnavailable(p);assert.equal(p.calls.some(c=>c.action==='get_daily_close_preview'),false);
  await p.reload('2026-09-23');p.el('a_cash').value='150';
  history.resolve(response([]));await flush();
  assert.equal(p.calls.filter(c=>c.action==='get_daily_close_preview').length,1);
  assert.equal(p.el('a_cash').value,'150');assert.equal(p.run('P.date'),'2026-09-23');
});

test('failed refresh and successful retry preserve the user note',async()=>{
  const p=await setup();p.el('notes').value='Counted by owner';
  p.state.handle=c=>c.action==='get_daily_close_preview'?{ok:false,status:404}:undefined;
  await p.reload();p.state.handle=null;await p.reload();
  assert.equal(p.el('notes').value,'Counted by owner');
});

test('error text is rendered as text, not HTML',async()=>{
  const p=await setup();p.state.handle=c=>{if(c.action==='get_daily_close_preview')throw new Error('<img src=x onerror=alert(1)>');};
  await p.reload();assertUnavailable(p);assert.match(p.el('status').textContent,/<img/);
  assert.doesNotMatch(p.el('status').innerHTML,/<img/);
  assert.match(inline,/\$\('status'\)\.textContent=\(err\.message/);
});
