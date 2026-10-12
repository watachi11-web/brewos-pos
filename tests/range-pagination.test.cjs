const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Paging=require('../range-paging');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
function setup(file){
 const html=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
 const source=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).join('\n').replace("document.getElementById('rDate').value=todayBkk();addPurchaseLine();reloadAll();",'');
 const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>[m[1],{value:'',textContent:'',innerHTML:'',disabled:false,style:{},classList:{remove(){},add(){}},getContext:()=>({})}]));
 const calls=[],downloads=[],charts=[],blobs=[];
 const context=vm.createContext({console,Date,Intl,URL:class extends URL{static createObjectURL(b){blobs.push(b);return 'blob:mock';}},Blob,AbortSignal,RangePaging:Paging,setTimeout(){},
  Identity:{getName:()=> 'TEST'},Chart:class{constructor(_ctx,config){this.config=config;this.destroyed=false;charts.push(this)}destroy(){this.destroyed=true}},
  localStorage:{getItem:()=>null},window:{addEventListener(){}},
  document:{getElementById:id=>elements.get(id),querySelectorAll:()=>[],addEventListener(){},createElement:()=>({click(){downloads.push(this)}})},
  fetch:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>({success:true,data:[]})}},
  API:{refundReport:async p=>{calls.push(p);return {orders:[],refund_cost_rows:[]}},orders(){}},
 });
 const run=s=>vm.runInContext(s,context);run(source);
 return {run,context,calls,downloads,charts,blobs,el:id=>elements.get(id)};
}
function historyRows(n,kind){return Array.from({length:n},(_,i)=>kind==='receipt'?{receipt_id:'R'+i,date:'2026-09-01',invoice_no:'INV'+i,supplier_name:'Supplier',total_amount:i}:{txn_id:'T'+i,ingredient_id:'I1',created_at:'2026-09-01T12:00:00',source_doc_id:'REF'+i,quantity_change:i});}
function historyFetch(h,receipts,transactions){h.context.fetch=async(url,opts)=>{h.calls.push({url,opts});return {ok:true,json:async()=>({success:true,data:String(url).includes('get_purchase_receipts')?receipts:transactions})};};}
test('date ranges validate actual calendar dates including leap years and order',()=>{
 assert.deepEqual(Paging.range('2024-02-29','2024-03-01'),{date_from:'2024-02-29',date_to:'2024-03-01'});
 for(const from of ['', '2026-02-29','2026-04-31','2026-13-01','<img>'])assert.throws(()=>Paging.range(from,'2026-12-31'));
 assert.throws(()=>Paging.range('2026-10-12','2026-10-11'));
});
test('pagination preserves every row and clamps empty, first and last pages',()=>{
 const rows=Array.from({length:61},(_,i)=>i);assert.deepEqual([0,1,2].flatMap(i=>Paging.page(rows,i,25).rows),rows);
 assert.equal(Paging.page(rows,99,25).index,2);assert.equal(Paging.page(rows,-2,25).previous,false);
 assert.equal(Paging.page([],0,25).next,false);assert.equal(Paging.page([],0,25).total,0);
});
test('history reads chosen dates with higher safe caps; pages reveal records past old 100/200 limits',async()=>{
 const h=setup('inventory.html');h.el('historyFrom').value='2026-09-01';h.el('historyTo').value='2026-09-30';historyFetch(h,historyRows(125,'receipt'),historyRows(260,'txn'));
 await h.run('loadHistory()');assert.equal(h.calls.length,2);
 for(const c of h.calls){const u=new URL(c.url);assert.equal(u.searchParams.get('date_from'),'2026-09-01');assert.equal(u.searchParams.get('date_to'),'2026-09-30');assert.equal(c.opts.method,undefined);}
 assert.equal(new URL(h.calls[0].url).searchParams.get('limit'),'2000');assert.equal(new URL(h.calls[1].url).searchParams.get('limit'),'5000');
 h.run("historyPage('receipt',4);historyPage('txn',10)");assert.match(h.el('receiptBody').innerHTML,/R124/);assert.match(h.el('txnBody').innerHTML,/REF259/);assert.equal(h.calls.length,2);assert.equal(h.el('receiptNext').disabled,true);
});
test('history search spans all loaded pages and resets page index',async()=>{
 const h=setup('inventory.html');historyFetch(h,historyRows(125,'receipt'),[]);await h.run('loadHistory()');h.run("historyPage('receipt',3)");
 h.el('historySearch').value='INV124';h.run('filterHistory()');assert.match(h.el('receiptBody').innerHTML,/R124/);assert.match(h.el('receiptPageStatus').textContent,/1 จาก 1/);assert.equal(h.run('historyState.receipt.page'),0);
});
test('empty/reversed dates issue no history request and disable navigation',async()=>{
 const h=setup('inventory.html');h.el('historyFrom').value='2026-10-30';h.el('historyTo').value='2026-10-01';await h.run('loadHistory()');assert.equal(h.calls.length,0);assert.equal(h.el('receiptNext').disabled,true);
});
test('one history failure does not hide the independently successful table',async()=>{
 const h=setup('inventory.html');h.context.fetch=async url=>{if(String(url).includes('get_purchase_receipts'))throw Error('<img onerror=bad>');return {ok:true,json:async()=>({success:true,data:historyRows(1,'txn')})}};
 await h.run('loadHistory()');assert.match(h.el('receiptBody').innerHTML,/&lt;img/);assert.equal(h.run('historyState.receipt.ready'),false);assert.equal(h.run('historyState.txn.ready'),true);
});
test('history at either API cap refuses misleading partial pagination',async()=>{
 const h=setup('inventory.html');historyFetch(h,historyRows(2000,'receipt'),historyRows(5000,'txn'));await h.run('loadHistory()');
 for(const k of ['receipt','txn']){assert.equal(h.el(k+'Next').disabled,true);assert.match(h.el(k+'PageStatus').textContent,/ลดช่วงวันที่/);assert.equal(h.run('historyState.'+k+'.ready'),false);}
});
test('late history responses cannot replace a newer range or an edited range',async()=>{
 const h=setup('inventory.html'),pending=[];h.context.fetch=url=>{const d=defer();pending.push(d);return d.promise;};
 const old=h.run('loadHistory()');h.el('historyFrom').value='2026-09-01';h.run('invalidateHistory()');const fresh=h.run('loadHistory()');
 pending.slice(2).forEach(d=>d.resolve({ok:true,json:async()=>({success:true,data:[]})}));await fresh;
 pending.slice(0,2).forEach(d=>d.resolve({ok:true,json:async()=>({success:true,data:historyRows(1,'receipt')})}));await old;
 assert.match(h.el('receiptPageStatus').textContent,/2026-09-01/);assert.equal(h.run('historyState.receipt.rows.length'),0);
});
const sale=(date,i)=>({order_id:'O'+i,transaction_id:'O'+i,date_key:date,created_at:date,order_status:'completed',payment_status:'paid',brand_id:'BB',total_amount:10,cogs:4,gross_profit:6,gross_margin_pct:60,items:[],cost_quality:{estimated_lines:0}});
function reportRange(h,from='2026-07-01',to='2026-09-30'){h.el('reportFrom').value=from;h.el('reportTo').value=to;h.run('reportRangeEdited()');}
test('custom report range and daily pagination retain every day, totals and all CSV rows',async()=>{
 const h=setup('reports.html');reportRange(h);
 const orders=Array.from({length:70},(_,i)=>sale(new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),i));
 h.context.API.refundReport=async p=>{h.calls.push(p);return {orders,refund_cost_rows:[{date_key:'2026-09-15',brand_id:'BB',consumed_cost:3,operation_id:'RFD-1',order_id:'R1'}]}};
 await h.run('loadReportData()');assert.equal(h.calls[0].date_from,'2026-07-01');assert.equal(h.calls[0].date_to,'2026-09-30');assert.equal(h.el('r-revenue').textContent,'฿700');assert.equal(h.el('r-avg').textContent,'฿417');
 h.run('changeDailyPage(2)');assert.match(h.el('daily-body').innerHTML,/01 Jul 2026/);assert.match(h.el('dailyPageStatus').textContent,/71 รายการ/);assert.equal(h.el('r-revenue').textContent,'฿700');assert.equal(h.calls.length,1);
 h.run('exportReport()');assert.equal(h.downloads.length,1);const csv=await h.blobs[0].text();assert.equal(csv.trim().split('\n').length,72);assert.match(csv,/REFUND_CONSUMED_COST/);assert.match(h.downloads[0].download,/2026-07-01_2026-09-30/);
});
test('out of range refund costs never enter custom report totals',async()=>{
 const h=setup('reports.html');reportRange(h,'2026-09-01','2026-09-01');h.context.API.refundReport=async()=>({orders:[sale('2026-09-01',1)],refund_cost_rows:[{date_key:'2026-08-31',brand_id:'BB',consumed_cost:99}]});
 await h.run('loadReportData()');assert.equal(h.el('r-avg').textContent,'฿6');
});
test('invalid report dates make no API calls, clear values and prevent CSV',async()=>{
 const h=setup('reports.html');reportRange(h,'2026-09-31','2026-10-01');await h.run('loadReportData()');h.run('exportReport()');assert.equal(h.calls.length,0);assert.equal(h.downloads.length,0);assert.equal(h.el('r-revenue').textContent,'—');
});
test('range changes immediately invalidate old totals, charts, navigation and export',async()=>{
 const h=setup('reports.html');reportRange(h);h.context.API.refundReport=async()=>({orders:[sale('2026-09-01',1)],refund_cost_rows:[]});await h.run('loadReportData()');assert.equal(h.run('REPORT_READY'),true);
 h.run('reportRangeEdited();exportReport()');assert.equal(h.el('r-revenue').textContent,'—');assert.equal(h.downloads.length,0);assert.ok(h.charts.every(c=>c.destroyed));assert.equal(h.el('dailyNext').disabled,true);
});
test('capped or failed reports expose range guidance, no partial totals or CSV',async()=>{
 for(const response of [async()=>({orders:Array.from({length:5000},(_,i)=>sale('2026-09-01',i)),refund_cost_rows:[]}),async()=>{throw Error('REPORT_RANGE_TOO_LARGE')},async()=>{throw Error('<img src=x>')}]){
  const h=setup('reports.html');reportRange(h);h.context.API.refundReport=response;await h.run('loadReportData()');h.run('exportReport()');assert.equal(h.el('r-revenue').textContent,'—');assert.equal(h.downloads.length,0);assert.equal(h.run('REPORT_READY'),false);assert.equal(h.el('top-menu-body').innerHTML,'');
 }
});
test('late successful or failed reports cannot overwrite the current selection',async()=>{
 const h=setup('reports.html'),a=defer(),b=defer();reportRange(h);let count=0;h.context.API.refundReport=()=>++count===1?a.promise:b.promise;
 const first=h.run('loadReportData()');reportRange(h,'2026-09-01','2026-09-02');const last=h.run('loadReportData()');b.resolve({orders:[sale('2026-09-02',2)],refund_cost_rows:[]});await last;a.reject(Error('old request'));await first;
 assert.equal(h.el('r-revenue').textContent,'฿10');assert.match(h.el('reportStatus').textContent,/2026-09-01 → 2026-09-02/);
});
