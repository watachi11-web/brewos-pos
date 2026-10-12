/* STAGED ONLY: pure server-side refund planner. No sheet/network writes.
 * Not loaded by any production page or Apps Script route.
 * Snapshot inputs must come from the server, never from a browser request.
 * A full, same-business-day, same-payment-channel refund is the only supported scope.
 */
var BrewRefundPlan = (function () {
  'use strict';
  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function text(v) { return String(v == null ? '' : v).trim(); }
  function number(v, code) {
    if (typeof v === 'boolean' || text(v) === '') fail(code);
    var n = Number(v); if (!Number.isFinite(n)) fail(code); return n;
  }
  function nonnegative(v, code) { var n=number(v,code); if(n<0)fail(code); return n; }
  function round(v) { return Math.round(v*100)/100; }
  function near(a,b) { return Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b)); }
  function date(v) {
    var s=text(v);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)fail('INVALID_DATE');
    return s;
  }
  function unique(rows,key) {
    var ids=new Set(); rows.forEach(function(r){var id=text(r[key]);if(!id||ids.has(id))fail('DUPLICATE_OR_MISSING_'+key.toUpperCase());ids.add(id);});
  }
  function build(request, snapshot) {
    request=request||{}; snapshot=snapshot||{};
    var root=text(request.order_id),op=text(request.operation_id),reason=text(request.reason),mode=text(request.disposition);
    if(!root||!/^RFD-[A-Za-z0-9-]{8,100}$/.test(op)||!reason||reason.length>500)fail('INVALID_REQUEST');
    if(mode!=='unprepared'&&mode!=='prepared')fail('DISPOSITION_REQUIRED');
    if(request.refund_confirmed!==true)fail('MANUAL_REFUND_CONFIRMATION_REQUIRED');
    ['orders','lines','inventoryTransactions','ingredients','dayStates','operations'].forEach(function(k){if(!Array.isArray(snapshot[k]))fail('INCOMPLETE_SNAPSHOT');});
    var today=date(snapshot.businessDate);
    // Only exact documented family IDs. Never use an arbitrary prefix match.
    var orders=snapshot.orders.filter(function(o){return [root,root+'-BB',root+'-HH'].indexOf(text(o.order_id))!==-1;});
    if(!orders.length)fail('ORDER_NOT_FOUND');
    unique(orders,'order_id');
    if(orders.some(function(o){return text(o.order_id)===root;})&&orders.length!==1)fail('AMBIGUOUS_ORDER_FAMILY');
    if(orders[0].order_id!==root&&!(orders.length===2&&orders.some(function(o){return o.order_id===root+'-BB';})&&orders.some(function(o){return o.order_id===root+'-HH';})))fail('INCOMPLETE_ORDER_FAMILY');
    // A child request could otherwise reverse the entire parent's shared stock ledger.
    if(/-(BB|HH)$/.test(root))fail('FULL_TRANSACTION_REQUIRED');
    var ids=new Set(orders.map(function(o){return text(o.order_id);}));
    unique(snapshot.lines.filter(function(l){return ids.has(text(l.order_id));}),'line_id');
    var existing=snapshot.operations.filter(function(o){return text(o.operation_id)===op||text(o.order_id)===root;});
    if(existing.length)fail(existing.some(function(o){return text(o.status)!=='committed';})?'REFUND_RECONCILIATION_REQUIRED':'ALREADY_REFUNDED');
    var days=snapshot.dayStates.filter(function(d){return text(d.date)===today;});
    if(days.length!==1||['open','reopened'].indexOf(text(days[0].status))===-1||days[0].locked!==false)fail('DAY_NOT_CONFIRMED_OPEN');
    var revenue=0,cost=0,byPayment={},byBrand={},preconditions=[];
    orders.forEach(function(o){
      if(date(o.business_date)!==today)fail('CROSS_DAY_REFUND_NOT_SUPPORTED');
      if(text(o.order_status)!=='completed'||text(o.payment_status)!=='paid')fail('ORDER_NOT_PAID_ACTIVE');
      var brand=text(o.brand_id),channel=text(o.payment_method);
      if(['BB','HH'].indexOf(brand)===-1)fail('UNKNOWN_BRAND');
      if(['cash','qr','transfer','card'].indexOf(channel)===-1)fail('UNKNOWN_PAYMENT_CHANNEL');
      if(o.order_id!==root&&o.order_id!==root+'-'+brand)fail('BRAND_FAMILY_MISMATCH');
      var subtotal=nonnegative(o.subtotal,'INVALID_REVENUE'),discount=nonnegative(o.discount_amount,'INVALID_DISCOUNT'),net=nonnegative(o.total_amount,'INVALID_REVENUE');
      if(discount>subtotal||!near(round(subtotal-discount),net)||!near(round(net),net))fail('ORDER_TOTAL_MISMATCH');
      revenue+=net;byPayment[channel]=(byPayment[channel]||0)+net;
      var lines=snapshot.lines.filter(function(l){return text(l.order_id)===text(o.order_id);});
      if(!lines.length)fail('MISSING_COST_SNAPSHOT');unique(lines,'line_id');
      var orderCost=0;
      lines.forEach(function(l){
        var qty=number(l.quantity,'INVALID_LINE_QUANTITY'),unitCost=nonnegative(l.cost_at_order,'MISSING_COST_SNAPSHOT');
        if(qty<=0||unitCost<=0)fail('MISSING_COST_SNAPSHOT');
        // The stored line snapshot already contains modifiers/sub-recipe cost.
        // Do not add current recipes or modifier costs again.
        var lineCost=qty*unitCost;if(!Number.isFinite(lineCost))fail('COST_OVERFLOW');orderCost+=lineCost;
      });
      cost+=orderCost;
      if(!byBrand[brand])byBrand[brand]={revenue_delta:0,cogs_delta:0,consumed_cost:0,gross_profit_delta:0};
      byBrand[brand].revenue_delta-=net;
      byBrand[brand].cogs_delta+=mode==='prepared'?0:-orderCost;
      byBrand[brand].consumed_cost+=mode==='prepared'?orderCost:0;
      preconditions.push({order_id:text(o.order_id),status:'completed',payment_status:'paid',total_amount:net,cost_snapshot:orderCost});
    });
    var related=snapshot.inventoryTransactions.filter(function(t){
      var ref=text(t.reference_id),doc=text(t.source_doc_id);
      return ref===root||doc===root||ids.has(ref)||ids.has(doc);
    });
    if(related.some(function(t){return ['cancel_restock','refund_restock'].indexOf(text(t.txn_type))!==-1;}))fail('EXISTING_STOCK_REVERSAL');
    var deductions=related.filter(function(t){return text(t.txn_type)==='sale_deduction';});
    if(!deductions.length)fail('MISSING_SALE_LEDGER');unique(deductions,'txn_id');
    var grouped=new Map();
    deductions.forEach(function(t){
      if(text(t.reference_id)!==root||(text(t.source_doc_id)&&text(t.source_doc_id)!==root))fail('AMBIGUOUS_SALE_LEDGER');
      var ingredient=text(t.ingredient_id),unit=text(t.unit_type),q=-number(t.quantity_change,'INVALID_SALE_QUANTITY');
      var before=number(t.qty_before,'INVALID_SALE_BALANCE'),after=number(t.qty_after,'INVALID_SALE_BALANCE');
      var unitCost=nonnegative(t.unit_price,'MISSING_SALE_COST'),value=nonnegative(t.transaction_value,'MISSING_SALE_COST');
      if(!ingredient||!unit||q<=0||!near(before-q,after)||!near(q*unitCost,value))fail('INVALID_SALE_LEDGER');
      if(grouped.has(ingredient))fail('DUPLICATE_INGREDIENT_DEDUCTION');
      grouped.set(ingredient,{ingredient_id:ingredient,unit:unit,quantity:q,value:value,original_txn_id:text(t.txn_id)});
    });
    var stockMoves=[];
    if(mode==='unprepared')grouped.forEach(function(d){
      var ingredients=snapshot.ingredients.filter(function(i){return text(i.ingredient_id)===d.ingredient_id;});
      if(ingredients.length!==1)fail('INGREDIENT_NOT_UNIQUE');
      var i=ingredients[0],stock=nonnegative(i.current_stock,'NEGATIVE_OR_INVALID_STOCK'),wac=nonnegative(i.unit_cost,'INVALID_WAC');
      if(text(i.unit)!==d.unit)fail('STOCK_UNIT_CHANGED');
      var next=stock+d.quantity,nextCost=(stock*wac+d.value)/next;
      if(!Number.isFinite(next)||!Number.isFinite(nextCost))fail('STOCK_VALUE_OVERFLOW');
      stockMoves.push({ingredient_id:d.ingredient_id,unit:d.unit,quantity_change:d.quantity,qty_before:stock,qty_after:next,unit_cost_before:wac,unit_cost_after:nextCost,transaction_value:d.value,reverses_txn_id:d.original_txn_id});
    });
    if(!Number.isFinite(revenue)||!Number.isFinite(cost))fail('TOTAL_OVERFLOW');
    Object.keys(byPayment).forEach(function(k){byPayment[k]=round(byPayment[k]);});
    Object.keys(byBrand).forEach(function(k){var b=byBrand[k];b.gross_profit_delta=b.revenue_delta-b.cogs_delta;Object.keys(b).forEach(function(f){b[f]=round(b[f]);});});
    return {version:1,operation_id:op,order_id:root,order_ids:Array.from(ids).sort(),business_date:today,reason:reason,disposition:mode,
      refund_amount:round(revenue),refund_by_payment:byPayment,manual_refund_only:true,stock_moves:stockMoves,preconditions:preconditions,
      accounting:{revenue_delta:-round(revenue),sale_cogs_removed:round(cost),consumed_cost_retained:mode==='prepared'?round(cost):0,cogs_delta:mode==='prepared'?0:-round(cost),gross_profit_delta:round(-revenue+(mode==='prepared'?0:cost)),expense_delta:0,by_brand:byBrand},
      requires_atomic_commit:true};
  }
  return {build:build};
})();
if(typeof module==='object'&&module.exports)module.exports=BrewRefundPlan;
