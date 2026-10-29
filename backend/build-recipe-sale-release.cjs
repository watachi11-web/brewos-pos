// Build a PRIVATE candidate from the exact reviewed production source.
// Does not deploy or activate it. Never check the generated source into Git.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const BASELINE_SHA='f96ff688688d2c6a4269b9e9d51bd65f27a686319fbf27079a421075e2638ee0';
function replaceOnce(s,a,b){if(s.split(a).length!==2)throw Error('Non-unique patch anchor: '+a);return s.replace(a,b);}
function build(source){
 if(crypto.createHash('sha256').update(source).digest('hex')!==BASELINE_SHA)throw Error('Baseline changed; inspect before building');
 const start=source.indexOf('function submitOrderCore_('),end=source.indexOf('// #CANCEL',start);
 if(start<0||end<0)throw Error('Missing sale core');
 // End immediately before the section banner; no statements follow the core.
 let core=source.slice(start,source.lastIndexOf('// ═',end));
 core=replaceOnce(core,'function submitOrderCore_(','function brewSalePrepareCore_(');
 core=replaceOnce(core,'discountJson, paymentMethod) {','discountJson, paymentMethod, saleContext) {');
 core=replaceOnce(core,'var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);','var ss = saleContext.ss;\n    var saleBuffer={orders:[],lines:[],modifiers:[]};');
 const dupStart=core.indexOf('    if (CONFIG.ORDER_IDEMPOTENCY) {'),dupEnd=core.indexOf('    var brandSubtotals = {};',dupStart);
 if(dupStart<0||dupEnd<0)throw Error('Missing legacy retry block');
 core=core.slice(0,dupStart)+core.slice(dupEnd);
 core=replaceOnce(core,'    var costWarnings = [];','    var costWarnings = [];\n    var stockPlan=brewRecipePlanItems_(saleContext.recipe,items);');
 core=replaceOnce(core,'orderSheet.appendRow([','saleBuffer.orders.push([');
 core=replaceOnce(core,'lineSheet.appendRow([','saleBuffer.lines.push([');
 core=replaceOnce(core,'appendOrderLineModifierRows_(ss, lineId','brewSaleCollectModifiers_(saleBuffer, lineId');
 core=replaceOnce(core,"          var lineId = rowOrderId + '-L' + (i + 1);","          costAtOrder=stockPlan.items[items.indexOf(item)].cost_per_item;\n          costSource='raw_at_sale_snapshot';\n          var lineId = rowOrderId + '-L' + (i + 1);");
 const writeStart=core.indexOf('    var integrityWarning = null;'),writeEnd=core.indexOf('    return {\n      success: true,',writeStart);
 if(writeStart<0||writeEnd<0)throw Error('Missing post-write stock section');
 core=core.slice(0,writeStart)+"    var integrityWarning=null;\n    var stockResult={deducted:stockPlan.stock.stock_moves.map(function(m){return {ingredient_id:m.ingredient_id,before:m.stock_before,after:m.stock_after,used:m.quantity};}),skipped:[],shortages:stockPlan.stock.stock_moves.filter(function(m){return m.shortage>0;})};\n"+core.slice(writeEnd);
 core=replaceOnce(core,'      integrity_warning: integrityWarning','      integrity_warning: integrityWarning,\n      _sale:{rows:saleBuffer,stock_moves:stockPlan.stock.stock_moves,now:now}');
 if(/\.appendRow\(|\.setValue\(|SpreadsheetApp\.flush\(/.test(core))throw Error('Prepared core still contains business writes');
 const modStart=source.indexOf('function appendOrderLineModifierRows_('),modEnd=source.indexOf('function buildCurrentProductCostInfoMap(',modStart);
 let mods=source.slice(modStart,modEnd);
 mods=replaceOnce(mods,'function appendOrderLineModifierRows_(ss,','function brewSaleCollectModifiers_(saleBuffer,');
 mods=replaceOnce(mods,"  var sheet = ss.getSheetByName('order_line_modifiers');\n  if (!sheet) return;\n",'');
 mods=replaceOnce(mods,'sheet.appendRow([','saleBuffer.modifiers.push([');
 source=replaceOnce(source,"VERSION: '6.2.4-REFUND-GUARD'","VERSION: '6.2.5-RECIPE-STOCK'");
 source=replaceOnce(source,"      submit_order:         function() { return submitOrderDirect(body); },","      get_sale_status:      function() { return brewSaleStatus_(body); },\n      submit_order:         function() { return submitOrderDirect(body); },");
 source=replaceOnce(source,'refund_release:BREWOS_REFUND_RELEASE_ID','refund_release:BREWOS_REFUND_RELEASE_ID, atomic_sales:brewSaleEnabled_(), recipe_release:BREWOS_RECIPE_RELEASE_ID');
 source=replaceOnce(source,'function submitOrderDirect(){var args=arguments;','function submitOrderDirect(){if(brewSaleEnabled_())return brewSaleDirect_(arguments[0]);var args=arguments;');
 source=replaceOnce(source,'function submitOrder(){var args=arguments;','function submitOrder(){if(brewSaleEnabled_())return {success:false,error:"กรุณารีโหลดหน้า POS เป็นรุ่นใหม่ก่อนบันทึก",code:"SALE_CLIENT_UPGRADE_REQUIRED",do_not_retry:false,result_unknown:false};var args=arguments;');
 source=replaceOnce(source,'    brewRefundAssertNoPending_();\n    return fn();','    brewRefundAssertNoPending_();\n    brewSaleAssertNoPending_();\n    return fn();');
 source=replaceOnce(source,"    snapshot:function(){\n      if(typeof Sheets==='undefined')", "    snapshot:function(){\n      brewSaleAssertNoPending_();\n      if(typeof Sheets==='undefined')");
 source=replaceOnce(source,'function deductStockForOrder(){var args=arguments;','function deductStockForOrder(){if(brewSaleEnabled_())throw Error("USE_ATOMIC_SALE_FLOW");var args=arguments;');
 source=replaceOnce(source,'function restoreStockForOrder(){var args=arguments;','function restoreStockForOrder(){if(brewSaleEnabled_())throw Error("USE_REFUND_FLOW");var args=arguments;');
 source=replaceOnce(source,"var orders=table(tables.orders,['order_id','order_status','payment_status','notes','updated_at']);","var orders=table(tables.orders,['order_id','order_status','payment_status','notes']);\n    var updatedColumn=orders.headers.indexOf('updated_at')>=0?'updated_at':orders.headers.indexOf('completed_at')>=0?'completed_at':null;\n    if(!updatedColumn)fail('MISSING_ORDER_TIMESTAMP_COLUMN');");
 source=replaceOnce(source,"set(orders,r,'updated_at',now),",'');
 source=replaceOnce(source,"+plan.reason+']'));","+plan.reason+']'));\n      if(updatedColumn==='updated_at')requests.push(set(orders,r,updatedColumn,now));");
 const modules=['recipe-stock-plan.js','recipe-stock-adapter.gs','sale-commit.js','sale-batch.js','sale-service.gs','sale-admin.gs'];
 const body=source+'\n'+core+'\n'+mods+'\n'+modules.map(f=>fs.readFileSync(path.join(__dirname,f),'utf8')).join('\n');
 const release=crypto.createHash('sha256').update(body).digest('hex');
 const out=body+'\nvar BREWOS_RECIPE_RELEASE_ID='+JSON.stringify(release)+';\n';
 new vm.Script(out);return out;
}
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output||path.resolve(input)===path.resolve(output))throw Error('Distinct input/output paths required');fs.writeFileSync(output,build(fs.readFileSync(input,'utf8')),{flag:'wx'});console.log('Private disabled candidate built: '+output);}
module.exports={build,BASELINE_SHA};
