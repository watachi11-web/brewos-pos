/* Pure atomic Sheets request builder, staged only. All tables and balances must
 * come from the locked server snapshot. No I/O; no schema creation or retries.
 */
var BrewSaleBatch=(function(){
  'use strict';
  var columns={
    orders:['order_id','brand_id','order_type','order_status','payment_status','table_number','customer_id','customer_name','subtotal','discount_amount','tax_amount','service_charge','total_amount','payment_method','cashier_id','notes','created_at','completed_at'],
    order_lines:['line_id','order_id','product_id','product_name','quantity','unit_price','modifier_total','line_total','cost_at_order','notes','status'],
    order_line_modifiers:['line_modifier_id','line_id','order_id','product_id','group_id','option_id','option_name','ingredient_id','qty_per_item','unit','quantity_total','price_delta_per_item','cost_per_item','cost_total','created_at','notes'],
    sale_operations:['order_id','fingerprint','status','result_json','created_at']
  };
  function cell(v){
    if(typeof v==='number'&&Number.isFinite(v))return {userEnteredValue:{numberValue:v}};
    if(typeof v==='string'&&v.length<45000)return {userEnteredValue:{stringValue:v}};
    throw Error('INVALID_SALE_CELL');
  }
  function table(t,required){
    if(!t||!Number.isInteger(t.sheetId)||t.sheetId<0||!Array.isArray(t.headers)||!Array.isArray(t.rows)||new Set(t.headers).size!==t.headers.length)throw Error('INVALID_SALE_TABLE');
    required.forEach(function(h){if(t.headers.indexOf(h)<0)throw Error('MISSING_SALE_HEADER_'+h);});return t;
  }
  function append(t,o){
    // Leave trailing computed columns (Net Profit / date formulas) untouched.
    var last=Math.max.apply(null,Object.keys(o).map(function(h){return t.headers.indexOf(h);}));
    return {appendCells:{sheetId:t.sheetId,rows:[{values:t.headers.slice(0,last+1).map(function(h){return cell(Object.prototype.hasOwnProperty.call(o,h)?o[h]:'');})}],fields:'userEnteredValue'}};
  }
  function update(t,r,key,v){return {updateCells:{start:{sheetId:t.sheetId,rowIndex:r._row,columnIndex:t.headers.indexOf(key)},rows:[{values:[cell(v)]}],fields:'userEnteredValue'}};}
  function object(cols,values){if(values.length!==cols.length)throw Error('SALE_ROW_LENGTH_MISMATCH');var o={};cols.forEach(function(h,i){o[h]=values[i];});return o;}
  function near(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<0.00001;}
  function prepare(plan,fingerprint,tables){
    if(!plan||!plan.result||plan.result.success!==true||!plan.rows||!Array.isArray(plan.stock_moves)||!/^\d{4}-\d{2}-\d{2}T/.test(plan.now))throw Error('INVALID_SALE_PLAN');
    var id=plan.result.order_id,ids=new Set(),requests=[];
    Object.keys(columns).forEach(function(n){table(tables[n],columns[n]);});
    table(tables.ingredients,['ingredient_id','unit','current_stock','unit_cost']);
    table(tables.inventory_transactions,['txn_id','ingredient_id','txn_type','quantity_change','unit_type','qty_before','qty_after','reference_id','notes','created_at','unit_cost_before','unit_cost_after','unit_price','transaction_value','source_doc_type','source_doc_id','shortage_qty']);
    Object.keys(tables).forEach(function(n){var sid=tables[n].sheetId;if(ids.has(sid))throw Error('SALE_TABLE_ID_COLLISION');ids.add(sid);});
    var orders=plan.rows.orders.map(function(r){return object(columns.orders,r);});
    var lines=plan.rows.lines.map(function(r){return object(columns.order_lines,r);});
    var mods=plan.rows.modifiers.map(function(r){return object(columns.order_line_modifiers,r);});
    var orderIds=new Set(),lineIds=new Set(),modIds=new Set(),stockIds=new Set();
    if(!orders.length||!lines.length||orders.length>2)throw Error('EMPTY_OR_INVALID_SALE');
    var revenue=0;
    orders.forEach(function(o){
      if(orderIds.has(o.order_id)||['BB','HH'].indexOf(o.brand_id)<0||o.order_id!==(orders.length>1?id+'-'+o.brand_id:id)||o.order_status!=='completed'||o.payment_status!=='paid')throw Error('INVALID_SALE_FAMILY');
      if(!near(o.subtotal-o.discount_amount,o.total_amount)||o.subtotal<0||o.discount_amount<0||o.total_amount<0||o.tax_amount!==0||o.service_charge!==0)throw Error('INVALID_SALE_TOTAL');
      if(tables.orders.rows.some(function(r){return r.order_id===o.order_id;}))throw Error('ORDER_ALREADY_EXISTS');
      orderIds.add(o.order_id);revenue+=o.total_amount;
      requests.push(append(tables.orders,o));
    });
    if(!near(revenue,plan.result.grand))throw Error('SALE_RESULT_TOTAL_MISMATCH');
    lines.forEach(function(l){
      if(!l.line_id||lineIds.has(l.line_id)||!orderIds.has(l.order_id)||!Number.isInteger(l.quantity)||l.quantity<=0||!Number.isFinite(l.cost_at_order)||l.cost_at_order<0||!near(l.quantity*l.unit_price,l.line_total))throw Error('INVALID_SALE_LINE');
      if(tables.order_lines.rows.some(function(r){return r.line_id===l.line_id;}))throw Error('SALE_LINE_ALREADY_EXISTS');
      lineIds.add(l.line_id);requests.push(append(tables.order_lines,l));
    });
    orders.forEach(function(o){var subtotal=lines.filter(function(l){return l.order_id===o.order_id;}).reduce(function(s,l){return s+l.line_total;},0);if(!near(subtotal,o.subtotal))throw Error('SALE_LINES_TOTAL_MISMATCH');});
    mods.forEach(function(m){
      var line=lines.filter(function(l){return l.line_id===m.line_id;})[0];
      if(!m.line_modifier_id||modIds.has(m.line_modifier_id)||!line||line.order_id!==m.order_id||line.product_id!==m.product_id)throw Error('INVALID_SALE_MODIFIER');
      if(tables.order_line_modifiers.rows.some(function(r){return r.line_modifier_id===m.line_modifier_id;}))throw Error('SALE_MODIFIER_ALREADY_EXISTS');
      modIds.add(m.line_modifier_id);requests.push(append(tables.order_line_modifiers,m));
    });
    plan.stock_moves.forEach(function(m,index){
      if(stockIds.has(m.ingredient_id)||!(m.quantity>0)||!(m.unit_cost>=0)||!near(m.stock_before-m.quantity,m.stock_after)||!near(m.quantity*m.unit_cost,m.transaction_value))throw Error('INVALID_SALE_STOCK_MOVE');
      stockIds.add(m.ingredient_id);
      var hits=tables.ingredients.rows.filter(function(r){return r.ingredient_id===m.ingredient_id;});
      if(hits.length!==1||!Number.isInteger(hits[0]._row)||hits[0]._row<1)throw Error('SALE_STOCK_ROW_NOT_UNIQUE');
      var r=hits[0];if(r.unit!==m.unit||r.current_stock!==m.stock_before||r.unit_cost!==m.unit_cost)throw Error('SALE_STOCK_CHANGED');
      var txid='ITX-'+id+'-S'+(index+1);
      if(tables.inventory_transactions.rows.some(function(t){return t.txn_id===txid||t.reference_id===id&&t.txn_type==='sale_deduction';}))throw Error('SALE_LEDGER_ALREADY_EXISTS');
      requests.push(update(tables.ingredients,r,'current_stock',m.stock_after));
      requests.push(append(tables.inventory_transactions,{txn_id:txid,ingredient_id:m.ingredient_id,brand_id:'SHARED',txn_type:'sale_deduction',quantity_change:-m.quantity,unit_type:m.unit,qty_before:m.stock_before,qty_after:m.stock_after,reference_id:id,notes:'Raw-at-sale recipe snapshot; no manual batch deduction',performed_by:'system',created_at:plan.now,unit_cost_before:m.unit_cost,unit_cost_after:m.unit_cost,unit_price:m.unit_cost,transaction_value:m.transaction_value,source_doc_type:'order',source_doc_id:id,shortage_qty:Math.max(0,m.quantity-Math.max(0,m.stock_before))}));
    });
    if(!stockIds.size)throw Error('EMPTY_SALE_STOCK_PLAN');
    var lineCost=lines.reduce(function(s,l){return s+l.cost_at_order*l.quantity;},0);
    var ledgerCost=plan.stock_moves.reduce(function(s,m){return s+m.transaction_value;},0);
    var roundingTolerance=lines.reduce(function(s,l){return s+l.quantity*0.00005;},0)+0.0000001;
    if(Math.abs(lineCost-ledgerCost)>roundingTolerance)throw Error('SALE_COST_LEDGER_MISMATCH');
    if(tables.sale_operations.rows.some(function(r){return r.order_id===id;}))throw Error('SALE_OPERATION_EXISTS');
    requests.push(append(tables.sale_operations,{order_id:id,fingerprint:fingerprint,status:'committed',result_json:JSON.stringify(plan.result),created_at:plan.now}));
    return {requests:requests,includeSpreadsheetInResponse:false};
  }
  return {columns:columns,prepare:prepare};
}());
if(typeof module!=='undefined'&&module.exports)module.exports=BrewSaleBatch;
