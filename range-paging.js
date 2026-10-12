/* Read-only range validation and display pagination. Never changes API totals. */
var RangePaging = (function(){
  function validDate(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    var date=new Date(value+'T00:00:00Z');
    return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
  }
  function range(from,to){
    if(!validDate(from)||!validDate(to))throw Error('กรุณาระบุวันที่เริ่มและสิ้นสุดให้ถูกต้อง');
    if(from>to)throw Error('วันที่เริ่มต้องไม่อยู่หลังวันที่สิ้นสุด');
    return {date_from:from,date_to:to};
  }
  function page(rows,index,size){
    if(!Array.isArray(rows)||!Number.isInteger(size)||size<1)throw Error('ข้อมูลแบ่งหน้าไม่ถูกต้อง');
    var pages=Math.max(1,Math.ceil(rows.length/size));
    index=Math.max(0,Math.min(Number.isInteger(index)?index:0,pages-1));
    return {rows:rows.slice(index*size,(index+1)*size),index:index,pages:pages,total:rows.length,
      label:rows.length?'หน้า '+(index+1)+' / '+pages+' · '+(index*size+1)+'–'+Math.min((index+1)*size,rows.length)+' จาก '+rows.length+' รายการ':'ไม่พบรายการในช่วง/คำค้นนี้',
      previous:index>0,next:index+1<pages};
  }
  return {validDate:validDate,range:range,page:page};
})();
if(typeof module==='object'&&module.exports)module.exports=RangePaging;
