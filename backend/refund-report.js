/* Shared read-side cost projection; input sales must already exclude refunded
 * orders. Retained cost is non-cash COGS, NOT a second payment or an expense.
 * Unresolved records fail closed instead of allowing a day to close on stale totals.
 */
var BrewRefundReport = (function(){
  'use strict';
  function sum(operations,from,to,brand){
    if(!Array.isArray(operations)||!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to||brand&&!['ALL','BB','HH'].includes(brand))throw Error('REFUND_QUERY_INVALID');
    var ids=new Set(),roots=new Set(),cost=0,refund=0,byPayment={},byBrand={BB:0,HH:0};
    operations.forEach(function(o){
      if(!o.operation_id||!o.order_id||!/^\d{4}-\d{2}-\d{2}$/.test(o.business_date)||ids.has(o.operation_id)||roots.has(o.order_id))throw Error('REFUND_RECORD_CONFLICT');
      ids.add(o.operation_id);roots.add(o.order_id);
      if(o.status!=='committed')throw Error('REFUND_RECONCILIATION_REQUIRED');
      if(o.business_date<from||o.business_date>to)return;
      var p=JSON.parse(o.plan_json),r=JSON.parse(o.result_json);
      if(p.operation_id!==o.operation_id||p.order_id!==o.order_id||p.business_date!==o.business_date||r.success!==true||r.operation_id!==o.operation_id||r.order_id!==o.order_id)throw Error('REFUND_RECORD_INVALID');
      if(!['prepared','unprepared'].includes(p.disposition))throw Error('REFUND_RECORD_INVALID');
      if(!p.accounting||!p.accounting.by_brand||!Number.isFinite(p.accounting.consumed_cost_retained)||p.accounting.consumed_cost_retained<0)throw Error('REFUND_COST_INVALID');
      var brands=p.accounting.by_brand,total=0,paymentTotal=0;
      Object.keys(brands).forEach(function(b){
        var n=brands[b].consumed_cost;
        if(!['BB','HH'].includes(b)||typeof n!=='number'||!Number.isFinite(n)||n<0||(p.disposition==='unprepared'&&n!==0))throw Error('REFUND_COST_INVALID');
        total+=n;byBrand[b]+=n;if(!brand||brand==='ALL'||brand===b)cost+=n;
      });
      if(Math.abs(total-p.accounting.consumed_cost_retained)>0.011||!Number.isFinite(p.refund_amount)||p.refund_amount<0||r.refund_amount!==p.refund_amount||r.consumed_cost!==p.accounting.consumed_cost_retained)throw Error('REFUND_TOTAL_INVALID');
      refund+=p.refund_amount;
      Object.keys(p.refund_by_payment).forEach(function(k){var n=p.refund_by_payment[k];if(!['cash','qr','transfer','card'].includes(k)||!Number.isFinite(n)||n<0)throw Error('REFUND_PAYMENT_INVALID');paymentTotal+=n;byPayment[k]=(byPayment[k]||0)+n;});
      if(Math.abs(paymentTotal-p.refund_amount)>0.011)throw Error('REFUND_PAYMENT_INVALID');
    });
    var round=function(n){return Math.round(n*100)/100;};
    if(!Number.isFinite(cost)||!Number.isFinite(refund))throw Error('REFUND_TOTAL_INVALID');
    Object.keys(byPayment).forEach(function(k){byPayment[k]=round(byPayment[k]);});Object.keys(byBrand).forEach(function(k){byBrand[k]=round(byBrand[k]);});
    // Payment reversal belongs to the whole transaction. Do not label the
    // full mixed-brand payment as belonging only to the selected cost brand.
    return {consumed_cost:round(cost),refund_amount_all_brands:round(refund),refund_by_payment_all_brands:byPayment,consumed_cost_by_brand:byBrand};
  }
  function apply(summary,projection){
    var out=Object.assign({},summary),loss=projection.consumed_cost;
    if(!Number.isFinite(loss)||loss<0)throw Error('REFUND_COST_INVALID');
    ['cogs','gross_profit','net_profit'].forEach(function(k){if(typeof out[k]!=='number'||!Number.isFinite(out[k]))throw Error('FINANCIAL_SUMMARY_INVALID');});
    if(Object.prototype.hasOwnProperty.call(out,'refund_consumed_cost'))throw Error('REFUND_COST_ALREADY_APPLIED');
    out.cogs+=loss;out.gross_profit-=loss;out.net_profit-=loss;out.refund_consumed_cost=loss;
    ['cogs','gross_profit','net_profit'].forEach(function(k){out[k]=Math.round(out[k]*100)/100;});
    return out;
  }
  return {sum:sum,apply:apply};
})();
if(typeof module==='object'&&module.exports)module.exports=BrewRefundReport;
