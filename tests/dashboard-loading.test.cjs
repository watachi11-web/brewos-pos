const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n');
const flush = () => new Promise(resolve=>setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r=>{resolve=r;}); return {promise,resolve}; }
function setup(overrides={}) {
  const elements = new Map();
  for (const m of html.matchAll(/\bid="([^"]+)"/g)) elements.set(m[1], {textContent:'',innerHTML:'',disabled:false});
  const timers = new Map(); let timerId=0;
  const API = {dashboardSummary:async()=>({today:{revenue:123},revenue_trend:[]}),ordersToday:async()=>[],ingredients:async()=>[],...overrides};
  const context = vm.createContext({API, console:{error(){}}, Date,
    Identity:{getBrand:()=> 'ALL',getName:()=> 'Test'},
    document:{getElementById:id=>elements.get(id),addEventListener(){}},
    setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),setInterval(){},
    calls:[],
  });
  const run = code=>vm.runInContext(code,context);
  run(script);
  run(`renderKPIs = data => { calls.push(['summary',data.today.revenue]); document.getElementById('kpi-grid').textContent=String(data.today.revenue); };
    renderRecentOrders = data => calls.push(['orders',data.length]);
    recomputeForPeriod = () => calls.push(['charts']);
    renderLowStock = data => calls.push(['stock',data.length]);`);
  return {API,run,timers,el:id=>elements.get(id),load:()=>run('loadDashboard()')};
}

test('summary and stock render without waiting for slow orders', async()=>{
  const pending=deferred(); const p=setup({ordersToday:()=>pending.promise});
  const load=p.load(); await flush();
  assert.equal(p.el('kpi-grid').textContent,'123');
  assert.match(p.el('stock-load-status').textContent,/อัปเดต/);
  assert.match(p.el('orders-load-status').textContent,/กำลังโหลด/);
  pending.resolve([]); await load;
  assert.equal(p.el('dashboard-retry').disabled,false);
});

test('one failed section does not remove successful sections; retry recovers',async()=>{
  const p=setup({ordersToday:async()=>{throw Error('<img onerror=alert(1)>');}});
  await p.load();
  assert.equal(p.el('kpi-grid').textContent,'123');
  assert.match(p.el('orders-load-status').textContent,/โหลดไม่สำเร็จ/);
  assert.equal(p.el('orders-load-status').innerHTML,'');
  p.API.ordersToday=async()=>[]; await p.load();
  assert.match(p.el('orders-load-status').textContent,/อัปเดต/);
});

test('refresh failure preserves old KPIs with explicit stale warning',async()=>{
  const p=setup(); await p.load();
  p.API.dashboardSummary=async()=>{throw Error('HTTP 500');}; await p.load();
  assert.equal(p.el('kpi-grid').textContent,'123');
  assert.match(p.el('summary-load-status').textContent,/ข้อมูลเดิม ณ/);
});

test('timeout releases retry and late response cannot replace newer data',async()=>{
  const pending=deferred(); const p=setup({dashboardSummary:()=>pending.promise});
  const first=p.load(); await flush();
  for(const fn of [...p.timers.values()])fn();
  await first;
  assert.match(p.el('summary-load-status').textContent,/45 วินาที/);
  assert.equal(p.el('dashboard-retry').disabled,false);
  p.API.dashboardSummary=async()=>({today:{revenue:999}}); await p.load();
  pending.resolve({today:{revenue:1}}); await flush();
  assert.equal(p.el('kpi-grid').textContent,'999');
});

test('overlapping refresh does not issue another batch',async()=>{
  const pending=deferred(); let count=0;
  const p=setup({dashboardSummary:()=>{count++;return pending.promise;}});
  const first=p.load(); await flush(); await p.load(); assert.equal(count,1);
  pending.resolve({today:{}}); await first;
});

test('malformed responses are errors, not confirmed zero data',async()=>{
  const p=setup({dashboardSummary:async()=>null,ordersToday:async()=>({}),ingredients:async()=>null});
  await p.load();
  for(const key of ['summary','orders','stock'])assert.match(p.el(key+'-load-status').textContent,/ยังไม่มีข้อมูลที่ยืนยันได้/);
});

test('POS warns before leaving with a cart, but not with an empty cart',()=>{
  const pos=fs.readFileSync(path.join(root,'pos.html'),'utf8');
  const source=pos.slice(pos.indexOf('const cart={};'),pos.indexOf('let pendingModifierMenu='));
  const listeners={}; const ctx=vm.createContext({window:{addEventListener:(type,fn)=>{listeners[type]=fn;}}});
  vm.runInContext(source,ctx);
  function event(){return {prevented:false,preventDefault(){this.prevented=true;}};}
  let e=event(); listeners.beforeunload(e); assert.equal(e.prevented,false);
  vm.runInContext('cart.test={qty:1}',ctx);
  e=event(); listeners.beforeunload(e); assert.equal(e.prevented,true); assert.equal(e.returnValue,'');
  vm.runInContext('delete cart.test',ctx);
  e=event(); listeners.beforeunload(e); assert.equal(e.prevented,false);
});
