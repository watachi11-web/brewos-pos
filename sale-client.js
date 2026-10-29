/* Save the exact request before POST. A network failure cannot create a new sale.
 * Recovery reads a matching committed journal before an exact acknowledgment.
 */
var BrewSaleClient=(function(){
  'use strict';
  const KEY='brewos_sale_pending_v1';
  const COMPLETED_KEY=KEY+'_completed';
  function create(api,storage,locks){
    function pending(){const raw=storage.getItem(KEY);return raw?JSON.parse(raw):null;}
    function exclusive(fn){
      if(!locks||typeof locks.request!=='function')throw Error('เบราว์เซอร์นี้ไม่รองรับการป้องกันบิลซ้ำ กรุณาเปิดใน Chrome หรือ Safari รุ่นล่าสุด');
      return locks.request(KEY,{mode:'exclusive'},fn);
    }
    function valid(r,p){return r&&r.success===true&&r.order_id===p.request.receipt_id;}
    function complete(result,p){
      // Other tabs can distinguish a verified completion from a no-write rejection.
      storage.setItem(COMPLETED_KEY,JSON.stringify({order_id:result.order_id,receipt:p.receipt}));
      storage.removeItem(KEY);
    }
    return {
      pending,
      async commit(request,receipt){
        return exclusive(async()=>{
          if(pending())throw Error('มีบิลรอตรวจสอบ กรุณาตรวจผลบิลค้างก่อนรับบิลใหม่');
          if(!/^RCP-[A-Za-z0-9_-]{2,116}$/.test(request.receipt_id||''))throw Error('เลขบิลไม่ถูกต้อง');
          const p=JSON.parse(JSON.stringify({request,receipt})),encoded=JSON.stringify(p);
          storage.setItem(KEY,encoded);
          if(storage.getItem(KEY)!==encoded)throw Error('บันทึกเลขบิลลงเครื่องไม่สำเร็จ ยังไม่ได้ส่งขาย');
          const result=await api.submitOrder(p.request);
          if(valid(result,p)){complete(result,p);return {result,receipt:p.receipt};}
          if(result&&result.success===false&&result.result_unknown===false&&result.do_not_retry===false)storage.removeItem(KEY);
          throw Error(result?.code||result?.error||'ยังยืนยันผลบิลไม่ได้ กรุณาตรวจผลบิลค้าง ห้ามรับเงินซ้ำ');
        });
      },
      async recover(){
        return exclusive(async()=>{
          const p=pending();if(!p)throw Error('ไม่มีบิลค้างบนเครื่องนี้');
          const status=await api.saleStatus(p.request);
          if(!valid(status,p)||status.verified!==true)throw Error('ยังยืนยันบิลไม่ได้ ต้องตรวจรายการที่ระบบก่อน ห้ามส่งบิลใหม่หรือรับเงินซ้ำ');
          const result=await api.submitOrder(p.request);
          if(!valid(result,p)||result.idempotent!==true)throw Error('พบผลขายแล้ว แต่ยังยืนยันสถานะระบบไม่ได้ กรุณาตรวจผลอีกครั้ง');
          complete(result,p);return {result,receipt:p.receipt};
        });
      }
    };
  }
  return {create,KEY,COMPLETED_KEY};
})();
if(typeof module==='object'&&module.exports)module.exports=BrewSaleClient;
