/* Purchase review is a client-side guard, not the accounting source of truth.
 * It never guesses mass/volume/oz conversions. Server validation still applies.
 */
(function(root){
  'use strict';
  const number=(value,label)=>{
    if(value===null||value===undefined||String(value).trim()==='')throw Error(label+' ต้องเป็นตัวเลข');
    const n=Number(value);if(!Number.isFinite(n))throw Error(label+' ต้องเป็นตัวเลข');return n;
  };
  const format=n=>Number(n).toLocaleString('th-TH',{maximumFractionDigits:4});
  const money=n=>'฿'+Number(n).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
  const unitMoney=n=>'฿'+Number(n).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:6});
  function quantity(line,ingredient){
    const q=number(line.purchase_qty,'จำนวนแพ็ก'),size=number(line.pack_size,'ขนาดต่อแพ็ก');
    if(q<=0||size<=0)throw Error('จำนวนแพ็กและขนาดต่อแพ็กต้องมากกว่า 0');
    const unit=String(line.pack_unit||''),base=String(ingredient.unit||'');
    let factor;
    if(base&&unit===base)factor=1;
    else if(base==='g'&&unit==='kg')factor=1000;
    else if(base==='ml'&&(unit==='L'||unit==='l'))factor=1000;
    else throw Error('หน่วยซื้อไม่ตรงกับหน่วยสต็อก ห้ามแปลงกรัม มิลลิลิตร หรือ oz แทนกันโดยเดา');
    const result=q*size*factor;
    if(!Number.isFinite(result)||result<=0)throw Error('จำนวนรวมไม่ถูกต้อง');
    return result;
  }
  function build(payload,ingredients){
    if(!Array.isArray(payload.lines)||!payload.lines.length)throw Error('กรุณาเพิ่มรายการรับเข้า');
    const discount=number(payload.discount??0,'ส่วนลดท้ายบิล');
    if(discount<0)throw Error('ส่วนลดท้ายบิลต้องไม่ติดลบ');
    const lines=payload.lines.map((l,index)=>{
      const ing=ingredients.find(i=>i.ingredient_id===l.ingredient_id);
      if(!ing)throw Error('รายการที่ '+(index+1)+': ไม่พบวัตถุดิบในสต็อก');
      const qty=quantity(l,ing),price=number(l.price_per_pack,'ราคาต่อแพ็ก'),lineDiscount=number(l.line_discount??0,'ส่วนลดรายการ');
      if(price<0||lineDiscount<0)throw Error('ราคาและส่วนลดต้องไม่ติดลบ');
      const gross=Number(l.purchase_qty)*price;
      if(!Number.isFinite(gross)||lineDiscount>gross)throw Error('ส่วนลดรายการต้องไม่เกินราคารวม');
      return {ingredient:ing,input:l,quantity:qty,net:gross-lineDiscount};
    });
    const subtotal=lines.reduce((sum,l)=>sum+l.net,0);
    if(!Number.isFinite(subtotal)||discount>subtotal)throw Error('ส่วนลดท้ายบิลต้องไม่เกินยอดหลังส่วนลดรายการ');
    const total=subtotal-discount,warnings=[];
    const quantities=new Map();
    for(const line of lines){
      const {ingredient:ing,input:l,quantity:qty,net}=line;
      quantities.set(ing.ingredient_id,(quantities.get(ing.ingredient_id)||0)+qty);
      // Estimate only; final allocation and WAC remain calculated by the backend.
      const allocated=subtotal>0?net*(total/subtotal):0;
      line.unitCost=allocated/qty;
      const oldCost=Number(ing.unit_cost),ratio=line.unitCost/oldCost;
      const name=ing.name||ing.ingredient_id;
      if(oldCost>0&&Number.isFinite(oldCost)&&(ratio>=4||ratio<=0.25))warnings.push(name+': ต้นทุนซื้อประมาณ '+unitMoney(line.unitCost)+'/'+ing.unit+' ต่างจากต้นทุนเดิม '+unitMoney(oldCost)+'/'+ing.unit+' ตั้งแต่ 4 เท่า — ตรวจขนาดและราคาอีกครั้ง');
      if(net===0)warnings.push(name+': ยอดซื้อ 0 บาท — ตรวจว่าเป็นของแถมหรือกรอกราคาครบแล้ว');
      if(/oz/i.test(String(ing.unit)))warnings.push(name+': ใช้ oz ตามหน่วยสต็อกเดิมเท่านั้น ยังไม่แปลงจากกรัมหรือมิลลิลิตร หากฉลากต่างหน่วยให้ตรวจค่าที่ร้านยืนยันก่อน');
    }
    for(const [id,qty] of quantities){
      const ing=ingredients.find(i=>i.ingredient_id===id),stock=Number(ing.current_stock);
      if(!Number.isFinite(qty))throw Error('จำนวนรับรวมของวัตถุดิบไม่ถูกต้อง');
      if(Number.isFinite(stock)&&stock>0&&qty>=stock*10)warnings.push((ing.name||id)+': รับ '+format(qty)+' '+ing.unit+' มากกว่าหรือเท่ากับ 10 เท่าของสต็อกปัจจุบัน '+format(stock)+' '+ing.unit+' — ตรวจจำนวนแพ็ก');
    }
    const details=lines.map(({ingredient:ing,input:l,quantity:qty,net},i)=>(i+1)+'. '+(ing.name||ing.ingredient_id)+'\n   '+format(l.purchase_qty)+' แพ็ก × '+format(l.pack_size)+' '+l.pack_unit+' = '+format(qty)+' '+ing.unit+'\n   '+money(l.price_per_pack)+'/แพ็ก · หลังส่วนลดรายการ '+money(net));
    const message=['ตรวจใบรับก่อนเพิ่มสต็อกจริง','วันที่ '+payload.date+' · ช่องทาง '+payload.payment_method,
      'ผู้ขาย: '+(payload.supplier_name||'ไม่ระบุ')+' · ใบเสร็จ: '+(payload.invoice_no||'ไม่ระบุ'),'',...details,'',
      'หลังส่วนลดรายการ '+money(subtotal),'ส่วนลดท้ายบิล '+money(discount),'ยอดสุทธิ '+money(total),
      ...(warnings.length?['','⚠️ ต้องตรวจเพิ่มเติม',...warnings.map(w=>'• '+w)]:[]),
      '','ยอดต้นทุนที่เตือนเป็นค่าประมาณ ไม่เปลี่ยนวิธีคำนวณ WAC ของระบบ','ยืนยันว่าจำนวน หน่วย และยอดเงินตรงกับใบเสร็จหรือไม่?'].join('\n');
    return {lines,total,warnings,message};
  }
  const api={build,quantity};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PurchaseReview=api;
})(typeof globalThis!=='undefined'?globalThis:this);
