const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),BrewUI=require('../ui-safe');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const part=(f,a,b)=>{const s=read(f);return s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));};
const hostile=`<Example & Co.> ' " <img src=x onerror=alert(1)>`;
function dom(){const elements=new Map();function make(){return {innerHTML:'',textContent:'',value:'',children:[],listeners:{},style:{},classList:{add(){},remove(){}},replaceChildren(){this.children=[];this.textContent='';},append(n){this.children.push(n);},addEventListener(k,f){this.listeners[k]=f;},querySelectorAll(){return [];}};}return {getElementById(id){if(!elements.has(id))elements.set(id,make());return elements.get(id);},createElement:make};}
test('customer normalization accepts CRM and legacy shapes without losing IDs',()=>{assert.deepEqual(BrewUI.customer({customer_id:'CUS-1',full_name:hostile,phone:'001'}),{customer_id:'CUS-1',full_name:hostile,phone:'001',brand_id:'SHARED'});assert.equal(BrewUI.customer({name:'Legacy'}).full_name,'Legacy');});
test('CRM table/detail treat customer fields and IDs as text',()=>{
 const document=dom(),c={customer_id:hostile,full_name:hostile,phone:hostile,email:hostile,brand_id:hostile,notes:hostile,tier:hostile,created_at:hostile};
 const ctx=vm.createContext({BrewUI,document,CUSTOMERS:[c],getFiltered:()=>[c],avatarColor:()=> '#123456',fmt:()=> '0',givePoints(){}});
 vm.runInContext(part('crm.html','function renderCustomers()','function closeDetail()'),ctx);ctx.renderCustomers();ctx.openDetail(hostile);
 for(const id of ['customer-body','detail-body']){const html=document.getElementById(id).innerHTML;assert(!html.includes('<Example'));assert(!html.includes('<img'));assert(!html.includes('onclick='));assert(html.includes('&lt;Example &amp; Co.&gt;'));}assert.equal(document.getElementById('detail-name').textContent,hostile);
});
test('Kitchen escapes names, quantities and order IDs outside executable handlers',()=>{
 const ctx=vm.createContext({BrewUI,timeDiffMinutes:()=>1,timerClass:()=>'',timeLabel:()=> '1m'});vm.runInContext(part('kitchen.html','function renderCard(','document.addEventListener'),ctx);
 const html=ctx.renderCard({order_id:hostile,customer_name:hostile,table_number:hostile,items:[{qty:hostile,name:hostile}]},'pending');assert(!html.includes('<img'));assert(!html.includes('onclick='));assert(html.includes('data-order-id="&lt;Example'));assert(html.includes('&lt;Example &amp; Co.&gt;'));
});
test('POS searches full_name and binds member clicks without interpolating HTML',async()=>{
 const document=dom(),ctx=vm.createContext({document,BrewUI,API:{customers:async()=>[{customer_id:'CUS-1',full_name:hostile,phone:'001'}]},selectedMember:null,cm(){},toast2(){}});
 vm.runInContext('let _customersCache=null;'+part('pos.html','let memberSearchVersion=0;','// ── OTHER'),ctx);await ctx.searchMember('Example');const button=document.getElementById('mResults').children[0];assert(button);assert.equal(button.innerHTML,'');assert(button.textContent.includes(hostile));button.listeners.click();assert.equal(ctx.selectedMember.customer_id,'CUS-1');assert.equal(document.getElementById('custNameInput').value,hostile);
 document.getElementById('custNameInput').value='different';document.getElementById('custNameInput').listeners.input();assert.equal(ctx.selectedMember,null);
});
test('POS receipt preserves special characters without rendering user HTML',()=>{
 const document=dom(),ctx=vm.createContext({document,escHtml:BrewUI.html,modifierOptionName:()=>hostile,getCartUnitPrice:()=>10,om(){}});vm.runInContext(part('pos.html','function showSuccess(','function closeSuccess'),ctx);ctx.showSuccess({items:[{menu:{name:hostile},qty:1,modifiers:[{}]}],disc:0,grand:10,note:hostile,rcpId:hostile,dateStr:hostile,timeStr:hostile});const html=document.getElementById('rcptBox').innerHTML;assert(!html.includes('<img'));assert(html.includes('&lt;Example &amp; Co.&gt;'));
});
test('retired login has navigation, no credentials or authentication simulation',()=>{const s=read('login.html');assert.match(s,/href="dashboard.html"/);assert.doesNotMatch(s,/<script|password|localStorage|sessionStorage|action=login|type="password"/i);});
