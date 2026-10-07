const {test}=require('node:test');
const assert=require('node:assert/strict');
const review=require('../purchase-review.js');
const ingredient=(extra={})=>({ingredient_id:'I1',name:'วัตถุดิบ',unit:'g',current_stock:2000,unit_cost:0.062,...extra});
const line=(extra={})=>({ingredient_id:'I1',purchase_qty:2,pack_size:2,pack_unit:'kg',price_per_pack:124,line_discount:0,...extra});
const payload=lines=>({date:'2026-10-07',payment_method:'qr',discount:0,lines});
test('2 bags of 2 kg are 4000 g and 248 baht, not oz',()=>{
  const result=review.build(payload([line()]),[ingredient()]);
  assert.equal(result.lines[0].quantity,4000);assert.equal(result.total,248);
  assert.equal(result.lines[0].unitCost,0.062);assert.match(result.message,/2 แพ็ก × 2 kg = 4,000 g/);
  assert.equal(result.warnings.length,0);
});
test('four full 165 g cans keep 660 g and 148 baht unchanged',()=>{
  const result=review.build(payload([line({purchase_qty:4,pack_size:165,pack_unit:'g',price_per_pack:37})]),[ingredient({unit_cost:0.215704})]);
  assert.equal(result.lines[0].quantity,660);assert.equal(result.total,148);
});
test('litres convert only to ml; mass-volume and oz conversions are rejected',()=>{
  assert.equal(review.quantity(line({pack_unit:'L'}),ingredient({unit:'ml'})),4000);
  for(const [purchase,base] of [['kg','ml'],['L','g'],['g','oz'],['ml','oz'],['oz','g']]){
    assert.throws(()=>review.quantity(line({pack_unit:purchase}),ingredient({unit:base})),/หน่วยซื้อไม่ตรง/);
  }
});
test('same-unit oz is not guessed but visibly asks the owner to check the conversion',()=>{
  const result=review.build(payload([line({pack_unit:'oz'})]),[ingredient({unit:'oz'})]);
  assert.equal(result.lines[0].quantity,4);assert.ok(result.warnings.some(w=>w.includes('ยังไม่แปลง')));
});
test('an extreme per-unit purchase cost warns without silently altering input',()=>{
  const p=payload([line({pack_size:70547,pack_unit:'g'})]),before=JSON.stringify(p);
  const result=review.build(p,[ingredient()]);
  assert.ok(result.warnings.some(w=>w.includes('ต้นทุนซื้อ')));
  assert.ok(result.warnings.some(w=>w.includes('10 เท่า')));
  assert.equal(JSON.stringify(p),before);
});
test('receipt discount is included in approximate unit costs and totals',()=>{
  const p=payload([line({line_discount:48}),line({ingredient_id:'I2',line_discount:48})]);p.discount=100;
  const result=review.build(p,[ingredient(),ingredient({ingredient_id:'I2'})]);
  assert.equal(result.total,300);assert.equal(result.lines[0].unitCost,150/4000);
});
test('bad factors, unknown ingredients and excessive discounts fail closed',()=>{
  for(const extra of [{purchase_qty:-2,pack_size:-2},{purchase_qty:0},{pack_size:Infinity},{price_per_pack:NaN},{line_discount:249},{ingredient_id:'unknown'}]){
    assert.throws(()=>review.build(payload([line(extra)]),[ingredient()]));
  }
  const p=payload([line()]);p.discount=249;assert.throws(()=>review.build(p,[ingredient()]),/ส่วนลดท้ายบิล/);
});
test('zero-price purchases warn and missing prior stock/cost does not invent a baseline',()=>{
  const result=review.build(payload([line({price_per_pack:0})]),[ingredient({current_stock:null,unit_cost:null})]);
  assert.equal(result.total,0);assert.equal(result.warnings.length,1);assert.match(result.warnings[0],/0 บาท/);
});
