// Preparation state is independent of financial order_status and stock.
// Append-only events: one durable row per transition, with optimistic concurrency.
var BREWOS_KITCHEN_HEADERS=['operation_id','order_id','version','from_status','status','updated_at','updated_by'];
function brewKitchenEvents_(ss){
  var t=brewRecipeTable_(ss,'kitchen_events');
  if(JSON.stringify(t.headers)!==JSON.stringify(BREWOS_KITCHEN_HEADERS))throw Error('KITCHEN_SCHEMA_INVALID');
  return t;
}
function brewKitchenState_(events,id){
  var state={status:'pending',version:0,updated_at:'',updated_by:''};
  events.filter(function(e){return String(e.order_id)===id;}).forEach(function(e){
    if(Number(e.version)!==state.version+1||e.from_status!==state.status||!['pending','making','done'].includes(e.status))throw Error('KITCHEN_EVENT_SEQUENCE_INVALID');
    state={status:e.status,version:Number(e.version),updated_at:e.updated_at,updated_by:e.updated_by};
  });return state;
}
function brewKitchenCancelled_(o){return /^(cancelled|canceled|refunded|void)$/i.test(String(o.order_status||''))||/^refunded$/i.test(String(o.payment_status||''));}
function brewKitchenQueue_(params){return brewRefundWithSnapshot_(function(){
  var ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID),events=brewKitchenEvents_(ss).rows;
  var date=String((params||{}).date||Utilities.formatDate(new Date(),'Asia/Bangkok','yyyy-MM-dd'));
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||normalizeDateKey_(date)!==date)throw Error('INVALID_KITCHEN_DATE');
  var orders=brewRecipeTable_(ss,'orders').rows.filter(function(o){return normalizeDateKey_(o.created_at)===date;});
  var lines=brewRecipeTable_(ss,'order_lines').rows,mods=brewRecipeTable_(ss,'order_line_modifiers').rows,ids=new Set();
  return {date:date,orders:orders.map(function(o){
    var id=String(o.order_id||'');if(!id||ids.has(id))throw Error('DUPLICATE_KITCHEN_ORDER');ids.add(id);
    var state=brewKitchenState_(events,id);
    return {order_id:id,brand_id:o.brand_id,created_at:normalizeDateTimeBkk_(o.created_at),customer_name:o.customer_name,notes:o.notes,
      preparation_status:brewKitchenCancelled_(o)?'cancelled':state.status,preparation_version:state.version,updated_at:state.updated_at,updated_by:state.updated_by,
      items:lines.filter(function(l){return String(l.order_id)===id;}).map(function(l){return {name:l.product_name||l.name,qty:l.quantity||l.qty,notes:l.notes,modifiers:mods.filter(function(m){return String(m.line_id)===String(l.line_id);}).map(function(m){return m.option_name;})};})};
  })};
});}
function brewKitchenUpdate_(p){return brewRefundWithSnapshot_(function(){
  p=p||{};var id=String(p.order_id||''),op=String(p.operation_id||''),next=p.status,version=p.expected_version;
  if(!id||id.length>200||!/^KDS-[a-zA-Z0-9-]{16,100}$/.test(op)||!Number.isInteger(version)||version<0||!['pending','making','done'].includes(next))throw Error('INVALID_KITCHEN_REQUEST');
  var ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID),t=brewKitchenEvents_(ss),prior=t.rows.filter(function(e){return String(e.operation_id)===op;});
  if(prior.length){var e=prior[0];if(prior.length!==1||String(e.order_id)!==id||Number(e.version)!==version+1||e.status!==next)throw Error('KITCHEN_OPERATION_CONFLICT');return {saved:true,replayed:true};}
  var found=brewRecipeTable_(ss,'orders').rows.filter(function(o){return String(o.order_id)===id;});
  if(found.length!==1)throw Error('KITCHEN_ORDER_NOT_FOUND');
  if(brewKitchenCancelled_(found[0]))throw Error('KITCHEN_ORDER_CANCELLED');
  var state=brewKitchenState_(t.rows,id);
  if(state.version!==version)throw Error('KITCHEN_STATE_CHANGED_REFRESH');
  var allowed={pending:['making'],making:['pending','done'],done:['making']};
  if(!allowed[state.status].includes(next))throw Error('INVALID_KITCHEN_TRANSITION');
  // Single-owner/no-login system: this is a source label, not a verified identity.
  t.sheet.appendRow([op,id,version+1,state.status,next,new Date().toISOString(),'owner-no-login']);
  SpreadsheetApp.flush();return {saved:true,replayed:false};
});}
