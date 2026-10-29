// Bundled into the reviewed hosted mobile_pos.html by the private builder.
let mobileSaleClient,mobileSaleBusy=false;
async function mobileSaleCall(action,params){
  if(typeof google!=='undefined'&&google.script){
    return new Promise((resolve,reject)=>{
      const run=google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
      if(action==='submit_order')run.submitOrderDirect(params);
      else if(action==='get_sale_status')run.getSaleStatus(params);
      else if(action==='ping')run.getSaleReadiness();
      else reject(Error('Unsupported action'));
    });
  }
  const response=action==='ping'?await fetch(BREWOS_API+'?action=ping&_ts='+Date.now(),{cache:'no-store'}):await fetch(BREWOS_API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...params,action})});
  if(!response.ok)throw Error('เชื่อมต่อระบบไม่สำเร็จ');
  const result=await response.json();if(!result.success)throw Error(result.error||'อ่านผลไม่สำเร็จ');return result.data;
}
function getMobileSaleClient(){
  if(!mobileSaleClient)mobileSaleClient=BrewSaleClient.create({submitOrder:p=>mobileSaleCall('submit_order',p),saleStatus:p=>mobileSaleCall('get_sale_status',p)},localStorage,navigator.locks);
  return mobileSaleClient;
}
function mobileSalePending(){return getMobileSaleClient().pending();}
function refreshMobileSalePending(){
  const panel=document.getElementById('salePending'),label=document.getElementById('salePendingText');
  if(!panel||!label)return; // Initial render can run before the trailing banner exists.
  try{
    const pending=mobileSalePending();panel.hidden=!pending;
    label.textContent=pending?'บิล '+pending.request.receipt_id+' รอตรวจผล กรุณาอย่ารับเงินหรือส่งบิลซ้ำ':'';
    document.getElementById('btnPay').disabled=mobileSaleBusy||!!pending||!Object.keys(cart).length;
  }catch(e){panel.hidden=false;label.textContent='อ่านบิลค้างในเครื่องไม่ได้: '+e.message;document.getElementById('btnPay').disabled=true;}
  document.getElementById('saleRecover').disabled=mobileSaleBusy;
}
async function recoverMobileSale(){
  if(mobileSaleBusy)return;mobileSaleBusy=true;refreshMobileSalePending();
  try{
    const saved=await getMobileSaleClient().recover();
    resetForm();
    document.getElementById('saleVerified').textContent='ยืนยันบิล '+saved.result.order_id+' ยอด '+saved.result.grand+' บาทแล้ว ไม่ต้องรับเงินซ้ำ ดูบิลได้ในประวัติ';
    showToast('ยืนยันบิลเดิมสำเร็จ');
  }catch(e){showToast(e.message);}
  finally{mobileSaleBusy=false;refreshMobileSalePending();}
}
async function sendOrderToBackend(customerName,room,pickupTime,note,cartItems,grand,rcpId,dateTimeStr,discountPayload,paymentMethod){
  const ready=await mobileSaleCall('ping');
  if(!ready||ready.atomic_sales!==true)throw Error('ระบบขายรุ่นใหม่ยังไม่พร้อม กรุณาติดต่อผู้ดูแลก่อนบันทึก');
  const request={sale_client_version:'atomic-v1',customer_name:customerName,room,pickup_time:pickupTime,note,items:cartItems,grand,receipt_id:rcpId,datetime:dateTimeStr,discount:discountPayload||{type:'',value:0,amount:0,reason:''},payment_method:paymentMethod};
  const saved=await getMobileSaleClient().commit(request,{rcpId,grand});return saved.result;
}
window.addEventListener('storage',e=>{
  if(e.key!==BrewSaleClient.KEY)return;
  try{if(e.oldValue&&!e.newValue){const old=JSON.parse(e.oldValue),done=JSON.parse(localStorage.getItem(BrewSaleClient.COMPLETED_KEY)||'null');
    if(done&&done.order_id===old.request.receipt_id){resetForm();showToast('บิลยืนยันแล้วจากอีกแท็บ เริ่มบิลใหม่ได้');}
  }}catch(_e){}
  refreshMobileSalePending();
});
window.addEventListener('DOMContentLoaded',refreshMobileSalePending);
