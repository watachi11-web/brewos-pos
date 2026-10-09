/* Build Sheets API v4 requests without performing I/O.
 * The adapter supplies server-read table IDs, headers, rows and zero-based indexes.
 * userEnteredValue only: never overwrite formulas/formatting in unrelated cells.
 */
var BrewRefundBatch = (function () {
  'use strict';
  var operationHeaders=['operation_id','order_id','business_date','status','request_json','plan_json','result_json','created_at'];
  function fail(s){throw Error(s);}
  function cell(value){
    if(typeof value==='number'){if(!Number.isFinite(value))fail('INVALID_CELL_NUMBER');return {userEnteredValue:{numberValue:value}};}
    if(typeof value!=='string')fail('INVALID_CELL_TYPE');
    if(value.length>45000)fail('CELL_VALUE_TOO_LARGE');
    // Explicit stringValue prevents a reason starting with '=' becoming a formula.
    return {userEnteredValue:{stringValue:value}};
  }
  function table(t,required){
    if(!t||!Number.isInteger(t.sheetId)||t.sheetId<0||!Array.isArray(t.headers)||!Array.isArray(t.rows))fail('TABLE_UNAVAILABLE');
    if(new Set(t.headers).size!==t.headers.length)fail('DUPLICATE_HEADERS');
    required.forEach(function(h){if(t.headers.indexOf(h)<0)fail('MISSING_HEADER_'+h);});return t;
  }
  function row(t,key,id){var found=t.rows.filter(function(r){return String(r[key])===String(id);});if(found.length!==1||!Number.isInteger(found[0]._row)||found[0]._row<1)fail('ROW_NOT_UNIQUE_'+key);return found[0];}
  function set(t,r,key,value){return {updateCells:{start:{sheetId:t.sheetId,rowIndex:r._row,columnIndex:t.headers.indexOf(key)},rows:[{values:[cell(value)]}],fields:'userEnteredValue'}};}
  function append(t,object){return {appendCells:{sheetId:t.sheetId,rows:[{values:t.headers.map(function(h){return cell(Object.prototype.hasOwnProperty.call(object,h)?object[h]:'');})}],fields:'userEnteredValue'}};}
  function prepare(plan,result,fingerprint,tables,now){
    var orders=table(tables.orders,['order_id','order_status','payment_status','notes','updated_at']);
    var ingredients=table(tables.ingredients,['ingredient_id','current_stock','unit_cost','unit']);
    var transactions=table(tables.transactions,['txn_id','ingredient_id','txn_type','quantity_change','unit_type','qty_before','qty_after','reference_id','notes','created_at','unit_cost_before','unit_cost_after','unit_price','transaction_value','source_doc_type','source_doc_id']);
    var operations=table(tables.operations,operationHeaders),requests=[];
    if(new Set([orders.sheetId,ingredients.sheetId,transactions.sheetId,operations.sheetId]).size!==4)fail('TABLE_ID_COLLISION');
    if(typeof now!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(now))fail('INVALID_TIMESTAMP');
    plan.order_ids.forEach(function(id){
      var r=row(orders,'order_id',id);
      if(r.order_status!=='completed'||r.payment_status!=='paid')fail('ORDER_CHANGED');
      requests.push(set(orders,r,'order_status','cancelled'),set(orders,r,'payment_status','refunded'),set(orders,r,'updated_at',now),set(orders,r,'notes',String(r.notes||'')+' [refund '+plan.operation_id+'; '+plan.disposition+'; '+plan.reason+']'));
    });
    plan.stock_moves.forEach(function(m,index){
      var r=row(ingredients,'ingredient_id',m.ingredient_id);
      if(r.unit!==m.unit||Number(r.current_stock)!==m.qty_before||Number(r.unit_cost)!==m.unit_cost_before)fail('STOCK_CHANGED');
      var id=plan.operation_id+'-S'+(index+1);
      if(transactions.rows.some(function(t){return t.txn_id===id;}))fail('STOCK_REVERSAL_ID_EXISTS');
      requests.push(set(ingredients,r,'current_stock',m.qty_after),set(ingredients,r,'unit_cost',m.unit_cost_after));
      requests.push(append(transactions,{txn_id:id,ingredient_id:m.ingredient_id,brand_id:'SHARED',txn_type:'refund_restock',quantity_change:m.quantity_change,unit_type:m.unit,qty_before:m.qty_before,qty_after:m.qty_after,reference_id:plan.order_id,notes:'Reversal of '+m.reverses_txn_id+'; '+plan.reason,performed_by:'owner',created_at:now,unit_cost_before:m.unit_cost_before,unit_cost_after:m.unit_cost_after,unit_price:m.transaction_value/m.quantity_change,transaction_value:m.transaction_value,source_doc_type:'refund',source_doc_id:plan.operation_id,shortage_qty:0}));
    });
    var record={operation_id:plan.operation_id,order_id:plan.order_id,business_date:plan.business_date,status:'pending',request_json:fingerprint,plan_json:JSON.stringify(plan),result_json:JSON.stringify(result),created_at:now};
    // Validate encoded intent before any write; a too-large plan must fail here.
    var intent=append(operations,record);
    return {intent:intent,record:record,requests:requests,operations:operations};
  }
  function commit(prepared,pending){
    if(pending.operation_id!==prepared.record.operation_id||pending.status!=='pending'||pending.request_json!==prepared.record.request_json||pending.plan_json!==prepared.record.plan_json||pending.result_json!==prepared.record.result_json||!Number.isInteger(pending._row)||pending._row<1)fail('INVALID_PENDING_RECORD');
    return {requests:prepared.requests.concat([set(prepared.operations,pending,'status','committed')]),includeSpreadsheetInResponse:false};
  }
  return {operationHeaders:operationHeaders,prepare:prepare,commit:commit};
})();
if(typeof module==='object'&&module.exports)module.exports=BrewRefundBatch;
