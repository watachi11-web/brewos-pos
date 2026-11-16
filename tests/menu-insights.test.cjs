const {test}=require('node:test');
const assert=require('node:assert/strict');
const M=require('../menu-insights.js');
const range={from:'2026-08-18',to:'2026-11-15'};
const products=[{id:'A'},{id:'B'}];
function order(id,date,qty,extra={}) {return {order_id:id,date_key:date,order_status:'completed',payment_status:'paid',items:[{line_id:id+'-1',product_id:'A',qty}],...extra};}
test('Bangkok completed-day range spans 90 days across UTC date boundary',()=>{
 assert.deepEqual(M.windowDates(new Date('2026-11-15T18:00:00Z')),range);
});
test('quantity excludes unpaid/cancelled/out of range and rejects unknown IDs',()=>{
 const orders=[order('1','2026-11-15',2),order('2','2026-10-17',3),order('3','2026-10-16',4),order('4','2026-11-16',99),order('5','2026-11-15',99,{payment_status:'unpaid'}),order('6','2026-11-15',99,{order_status:'cancelled'}),order('7','2026-08-17',99),order('8','2026-11-15',99,{items:[{product_id:'Unknown',qty:99}]})];
 assert.deepEqual(M.aggregate(orders,products,range).A,{qty30:5,qty90:9,last:'2026-11-15'});
});
test('duplicate orders and lines count only once; invalid quantities ignored',()=>{
 const o=order('1','2026-11-01',2);o.items.push({...o.items[0]},{product_id:'A',qty:-1},{product_id:'A',qty:'bad'});
 assert.equal(M.aggregate([o,o],products,range).A.qty30,2);
});
test('truncated or malformed responses fail closed',()=>{
 assert.throws(()=>M.aggregate(Array(5000).fill({}),products,range));
 assert.throws(()=>M.aggregate({},products,range));
});
test('pins precede sales, sorting stays in brand/category slots and preserves ties',()=>{
 const items=[{id:'A',brand:'HH',cat:'1'},{id:'X',brand:'BB',cat:'1'},{id:'B',brand:'HH',cat:'1'},{id:'C',brand:'HH',cat:'2'},{id:'D',brand:'HH',cat:'1',best:true}];
 const stats={A:{qty30:1},B:{qty30:10},X:{qty30:100}};
 assert.deepEqual(M.rank(items,stats).map(x=>x.id),['D','X','B','C','A']);
 assert.deepEqual(M.rank(items,null),items);
 assert.deepEqual(M.rank(items,{}).map(x=>x.id),['D','X','A','C','B']);
 assert.equal(items[0].id,'A');
});
test('reader supplies range and cap without mutations',async()=>{
 const result=await M.load({orders:async p=>{assert.deepEqual(p,{date_from:range.from,date_to:range.to,limit:5000});return [];}},products,new Date('2026-11-16T05:00:00Z'));
 assert.equal(Object.keys(result.stats).length,0);
});
