/* Durable intent BEFORE POST; unknown responses only allow a read-back check.
 * No money is transferred by this module. Manual refund confirmation is required.
 */
var BrewRefundClient=(function(){
  'use strict';
  const KEY='brewos_refund_pending_v1';
  function create(api,storage,locks,uuid){
    function pending(){const raw=storage.getItem(KEY);return raw?JSON.parse(raw):null;}
    function exclusive(fn){
      if(!locks||typeof locks.request!=='function')throw Error('เบราว์เซอร์นี้ไม่รองรับการป้องกันบันทึกซ้ำ กรุณาใช้ Chrome รุ่นล่าสุด');
      return locks.request(KEY,{mode:'exclusive'},fn);
    }
    function validResult(result,request){return result&&result.success===true&&result.operation_id===request.operation_id&&result.order_id===request.order_id;}
    return {
      pending,
      async preview(orderId,disposition,reason){
        if(pending())throw Error('มีการคืนเงินรอตรวจสอบ กรุณากดตรวจผลรายการค้างก่อน');
        const request={order_id:orderId,operation_id:'RFD-'+uuid(),disposition,reason:reason.trim(),refund_confirmed:true};
        if(!request.reason||request.reason.length>500||!['prepared','unprepared'].includes(disposition))throw Error('เลือกสถานะการทำสินค้าและระบุเหตุผลก่อน');
        const result=await api.refundPreview(request);
        if(!result||!result.success||!result.plan||result.plan.operation_id!==request.operation_id||result.plan.order_id!==orderId)throw Error(result?.code||'ตรวจรายการคืนเงินไม่สำเร็จ');
        return {request,plan:result.plan};
      },
      async commit(preview){
        return exclusive(async()=>{
          if(pending())throw Error('มีการคืนเงินรอตรวจสอบ ห้ามส่งรายการซ้ำ');
          const request=JSON.parse(JSON.stringify(preview.request));
          const encoded=JSON.stringify(request);storage.setItem(KEY,encoded);
          if(storage.getItem(KEY)!==encoded)throw Error('บันทึกเลขรายการลงเครื่องไม่สำเร็จ ยังไม่ได้ส่งคืนเงิน');
          // A transport error or malformed response leaves the pending intent intact.
          const result=await api.refundOrder(request);
          if(validResult(result,request)){storage.removeItem(KEY);return result;}
          if(result&&result.success===false&&result.stock_may_have_changed===false&&result.do_not_retry===false)storage.removeItem(KEY);
          throw Error(result?.code||'ยังยืนยันผลไม่ได้ ห้ามคืนเงินหรือส่งรายการซ้ำ');
        });
      },
      async recover(){
        return exclusive(async()=>{
          const request=pending();if(!request)throw Error('ไม่มีรายการค้างบนเครื่องนี้');
          const status=await api.refundStatus(request.operation_id);
          if(!validResult(status,request)||status.verified!==true)throw Error('ยังยืนยันผลไม่ได้ ต้องตรวจบันทึก backend ห้ามส่งซ้ำ');
          // The journal has positively verified COMMITTED. This exact retry only
          // acknowledges that recorded result and clears its server-side fence.
          const result=await api.refundOrder(request);
          if(!validResult(result,request)||result.idempotent!==true)throw Error('พบผลคืนเงินแล้ว แต่ยังยืนยันสถานะระบบไม่ได้');
          storage.removeItem(KEY);return result;
        });
      }
    };
  }
  return {create,KEY};
})();
if(typeof module==='object'&&module.exports)module.exports=BrewRefundClient;
