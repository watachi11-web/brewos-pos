// Injected before initMenus. No private HTML/configuration or production mutations.
let mobileInternalDepth=0, mobileMenuReady=false, mobileMenuState='loading', mobileRank=null, mobileTouched=false;
function mobileInternal(fn){mobileInternalDepth++;try{return fn();}finally{mobileInternalDepth--;}}
function mobileLocked(){if(mobileInternalDepth)return false;try{return mobileSaleBusy||!!mobileSalePending();}catch(_){return true;}}
const mobileDisabled=new Map();
function syncMobileControls(){
 const locked=mobileLocked();
 document.querySelectorAll('button,input,select,textarea,[role="button"]').forEach(el=>{
  if(el.id==='saleRecover'||el.closest('#salePending')||el.closest('#rcptOverlay')||el.closest('#ordersPage')||el.closest('#dashPage')||el.classList.contains('nav-btn'))return;
  if(locked){if(!mobileDisabled.has(el))mobileDisabled.set(el,el.disabled);el.disabled=true;el.setAttribute('aria-disabled','true');}
 });
 if(!locked){for(const [el,disabled]of mobileDisabled){el.disabled=disabled;el.removeAttribute('aria-disabled');}mobileDisabled.clear();}
 const pay=document.getElementById('btnPay');if(pay)pay.disabled=locked||!mobileMenuReady||!Object.keys(cart).length;
}
const originalRefreshPending=refreshMobileSalePending;
refreshMobileSalePending=function(){originalRefreshPending();syncMobileControls();};
for(const name of ['changeProductQty','changeCartLineQty','removeItem','clearCart','openModifierPicker','confirmModifierPicker','setPayMethod','saveNote','openNoteModal','openDiscModal','toggleBackdate','resetForm','setDiscType']){
 const original=window[name];window[name]=function(...args){if(mobileLocked())return;mobileTouched=true;return original.apply(this,args);};
}
const originalApplyDisc=applyDisc,originalClearDisc=clearDisc;
applyDisc=function(){if(mobileLocked())return;const v=Number(document.getElementById('discInput').value);if(!Number.isFinite(v)||v<0||(discType==='pct'&&v>100)){showToast('กรุณากรอกส่วนลดที่ถูกต้อง (เปอร์เซ็นต์ไม่เกิน 100)');return;}originalApplyDisc();updateCartUI();};
clearDisc=function(){if(mobileLocked())return;originalClearDisc();updateCartUI();};
const originalSetDiscType=setDiscType;
setDiscType=function(t){if(mobileLocked())return;originalSetDiscType(t);updateDiscChip();updateCartUI();};
const originalReset=resetForm;
resetForm=function(){if(mobileLocked())return;discType='pct';discValue=0;discReason='';for(const id of ['discInput','discReason','noteField','orderDate','orderTime'])document.getElementById(id).value='';document.getElementById('backdateToggle').checked=false;document.getElementById('backdateFields').style.display='none';document.getElementById('backdateWarn').style.display='none';originalReset();setDiscType('pct');updateDiscChip();updateCartUI();};
const originalConfirm=confirmOrder;
confirmOrder=function(){if(!mobileMenuReady||mobileLocked())return;return originalConfirm();};
function mobileRead(action,params={}){
 if(typeof google!=='undefined'&&google.script)return new Promise((resolve,reject)=>{
 const run=google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
 if(action==='get_menu_data')run.getMenuData();else run.getOrdersFromSheet(params);
 });
 const u=new URL(BREWOS_API);u.searchParams.set('action',action);for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
 return fetch(u,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then(j=>{if(!j.success)throw Error(j.error||'อ่านข้อมูลไม่ได้');return j.data;});
}
const originalRenderMenu=renderMenu;
renderMenu=function(){
 originalRenderMenu();
 const col=document.getElementById('menuCol');
 const ranking=document.createElement('div');ranking.setAttribute('role','status');ranking.style.cssText='font-size:11px;line-height:1.3;flex-shrink:0';ranking.textContent=mobileRank?'ร้านแนะนำก่อน · ยอดขาย 30 วันในแบรนด์/หมวด (ไม่หักคืนสินค้า)':(mobileTouched?'คงลำดับเมนูระหว่างรับบิล':'ลำดับเดิม · สถิติยังไม่พร้อม');col.prepend(ranking);
 if(mobileMenuState!=='ready'){
  const box=document.createElement('div');box.setAttribute('role','status');box.textContent=mobileMenuState==='loading'?'กำลังโหลดเมนู…':(navigator.onLine===false?'ออฟไลน์ — ตรวจการเชื่อมต่อ':'โหลดเมนูไม่สำเร็จ');
  if(mobileMenuState!=='loading'){const retry=document.createElement('button');retry.type='button';retry.textContent='ลองใหม่';retry.addEventListener('click',()=>{if(!mobileLocked())initMenus();});box.append(retry);}
  if(!PRODUCTS.length)col.replaceChildren(box);else col.prepend(box);
 }
 col.querySelectorAll('img').forEach(img=>img.loading='lazy');
 col.querySelectorAll('.menu-card').forEach(card=>{const p=PRODUCTS.find(x=>'mc-'+x.id===card.id);if(p?.best){const badge=document.createElement('span');badge.textContent='ร้านแนะนำ';card.querySelector('.mc-info').append(badge);}});
 document.querySelectorAll('.menu-card button,.cart-item button').forEach(b=>{const card=b.closest('.menu-card,.cart-item');b.setAttribute('aria-label',b.textContent.trim()+' '+(card?.querySelector('.mc-name,.ci-name')?.textContent||'รายการ'));});
 syncMobileControls();
};
let mobileLoadVersion=0;
initMenus=async function(){
 if(mobileLocked())return;
 const version=++mobileLoadVersion;mobileMenuState='loading';renderMenu();
 try{
  const raw=await mobileRead('get_menu_data');if(version!==mobileLoadVersion)return;
  if(!raw||!Array.isArray(raw.products)||!Array.isArray(raw.categories))throw Error('Invalid menu');
  CATS=[{id:'all',name:'ทั้งหมด',emoji:'🍽',brand:'ALL'},...raw.categories.map(c=>({id:c.category_id||c.id,name:c.name,emoji:c.emoji||'🍽',brand:c.brand_id}))];
  PRODUCTS=raw.products.filter(p=>p.is_available!==false).map(p=>({id:p.product_id||p.id,cat:p.category_id,name:p.name||p.name_th||'',sub:p.name_th||'',emoji:p.emoji||'🍽',price:Number(p.base_price||p.price||0),cost:Number(p.cost_price||p.cost||0),brand:p.brand_id||'',best:p.is_featured===true,imgUrl:normalizeImageUrl(p.image_url||''),modifierGroups:Array.isArray(p.modifier_groups)?p.modifier_groups:[]}));
  mobileMenuReady=true;mobileMenuState='ready';buildCatTabs();renderMenu();
  try{const metrics=await MenuInsights.load({orders:p=>mobileRead('get_orders_sheet',p)},PRODUCTS);if(version===mobileLoadVersion&&!mobileTouched&&!Object.keys(cart).length&&!mobileLocked()){mobileRank=metrics.stats;PRODUCTS=MenuInsights.rank(PRODUCTS,mobileRank);renderMenu();}}catch(_){/* Original ordering remains usable. */}
 }catch(_){if(version!==mobileLoadVersion)return;mobileMenuState='error';renderMenu();}
};
renderOrdersList=function(orders){
 const list=document.getElementById('ordersListEl');list.replaceChildren();
 const active=orders.filter(o=>o.order_status!=='cancelled'),cancelled=orders.filter(o=>o.order_status==='cancelled');
 for(const [id,value]of Object.entries({ordTodayCount:orders.length,ordTodayTotal:'฿'+Math.round(active.reduce((s,o)=>s+Number(o.total_amount||0),0)),ordFilterAll:orders.length,ordFilterCompleted:active.length,ordFilterCancelled:cancelled.length}))document.getElementById(id).textContent=value;
 const visible=_orderFilter==='cancelled'?cancelled:_orderFilter==='completed'?active:orders;
 function text(parent,cls,value){const el=document.createElement('div');el.className=cls;el.textContent=value;parent.append(el);return el;}
 if(!visible.length){text(list,'ord-empty','ไม่พบออเดอร์ในช่วง/ตัวกรองนี้');return;}
 for(const o of visible){const card=text(list,'ord-item','');text(card,'ord-cust',o.customer_name||'Walk-in');text(card,'ord-id',o.order_id);text(card,'ord-amt','฿'+Number(o.total_amount||0));text(card,'ord-time',String(o.created_at||'').slice(11,16));text(card,'ord-items-txt',(o.items||[]).map(i=>String(i.name)+' ×'+String(i.qty)).join(', '));text(card,'ord-badge',o.order_status==='cancelled'?'ยกเลิกแล้ว':String(o.order_status||''));if(o.order_status!=='cancelled'){text(card,'ord-actions','การคืนสินค้า: ใช้หน้ารายการออเดอร์บนเว็บหลัก พร้อมเลขบิลนี้');}}
};
openCancelModal=function(){showToast('กรุณาใช้หน้ารายการออเดอร์บนเว็บหลักเพื่อคืนสินค้า');};
// Accessible cart trigger and dialog focus lifecycle; no changes to sale transport.
const cartHead=document.querySelector('.cart-head');
if(cartHead){cartHead.tabIndex=0;cartHead.setAttribute('aria-expanded','false');cartHead.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleCartSheet();}});}
const originalToggleCart=toggleCartSheet;
toggleCartSheet=function(force){originalToggleCart(force);cartHead?.setAttribute('aria-expanded',String(cartSheetExpanded));};
const modalNames={noteOverlay:'หมายเหตุ',modifierOverlay:'ตัวเลือกสินค้า',discOverlay:'ส่วนลด',rcptOverlay:'ใบเสร็จ',cancelOverlay:'คืนสินค้า'};
for(const [id,name]of Object.entries(modalNames)){
 const overlay=document.getElementById(id);if(!overlay)continue;overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label',name);overlay.tabIndex=-1;let opener=null,opened=false;
 new MutationObserver(()=>{const on=overlay.classList.contains('open');if(on===opened)return;opened=on;if(on){opener=document.activeElement;(overlay.querySelector('button,input,textarea,select')||overlay).focus();}else opener?.focus();}).observe(overlay,{attributes:true,attributeFilter:['class']});
 overlay.addEventListener('keydown',e=>{const nodes=[...overlay.querySelectorAll('button,input,textarea,select,[tabindex="0"]')].filter(x=>!x.disabled&&x.getClientRects().length);if(e.key==='Escape'&&!mobileLocked()){e.preventDefault();if(id==='rcptOverlay')closeReceipt();else overlay.classList.remove('open');}if(e.key==='Tab'){const first=nodes[0]||overlay,last=nodes.at(-1)||overlay;if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
}
const staffParam=new URLSearchParams(window.location.search).get('staff')||sessionStorage.getItem('brewos_user');
if(staffParam){try{document.getElementById('staffName').textContent=JSON.parse(staffParam).name||'Staff';}catch(_){document.getElementById('staffName').textContent=staffParam;}}
document.addEventListener('pointerdown',()=>{mobileTouched=true;},true);
document.addEventListener('keydown',()=>{mobileTouched=true;},true);
