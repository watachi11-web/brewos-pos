/* Build from the reviewed production snapshot, never patch it in place.
 * Usage: node backend/build-refund-release.cjs /absolute/baseline.gs /absolute/output.gs
 * Output is private: contains the existing production database configuration.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const EXPECTED='7c0dc4b5b5255090510b8d8b3f651fe0ebedea861d1fc488bc83e25348fc3287';
const writers=['submitOrderDirect','submitOrder','reopenDay','closeDay','adjustStock','stocktakeIngredient','receivePurchase','receiveStock','createIngredient','updateIngredient','deleteIngredient','createProduct','updateProduct','deleteProduct','createCategory','updateCategory','createExpense','updateExpense','deleteExpense','createRecipeLines','updateSetting','createCustomer','updateCustomer','addCustomerPoints','createSupplierRecord','createAsset','updateAsset','deleteAsset','ensureAccountingSchema','applyPurchaseExpenseRepair550_','deductStockForOrder','restoreStockForOrder'];
const readers=['getFinanceSummary','getDailyClosePreview','getDashboardSummary','getInventoryStats','getOrdersFromSheet'];
function build(source){
  if(crypto.createHash('sha256').update(source).digest('hex')!==EXPECTED)throw Error('Baseline changed: review before building');
  function once(a,b){if(source.split(a).length!==2)throw Error('Patch anchor not unique: '+a);source=source.replace(a,b);}
  once("VERSION: '6.2.3-INVENTORY-GUARD'", "VERSION: '6.2.4-REFUND-GUARD'");
  once('return { pong: true, version: CONFIG.VERSION };', 'return { pong: true, version: CONFIG.VERSION, refund_enabled:brewRefundEnabled_(), refund_release:BREWOS_REFUND_RELEASE_ID };');
  source=source.replaceAll('LockService.getScriptLock()','brewRefundSharedLock_()');
  once('function cancelOrder(params)', 'function brewRefundLegacyCancel_(params)');
  const wrappers=[];
  for(const name of writers.concat(readers)){
    once('function '+name+'(', 'function brewRefundOriginal_'+name+'_(');
    wrappers.push('function '+name+'(){var args=arguments;return brewRefundWithSnapshot_(function(){return brewRefundOriginal_'+name+'_.apply(null,args);});}');
  }
  once("      ping:                   function()", "      get_refund_report:      function() { return getRefundAwareReport(params); },\n      get_refund_status:      function() { return brewRefundStatus_(params); },\n      ping:                   function()");
  once('      submit_order:', "      preview_refund:         function() { return brewRefundPreview_(body); },\n      refund_order:           function() { return brewRefundOrder_(body); },\n      submit_order:");
  // Hook values before existing rounding, ratios and aggregation.
  once('var grossProfit = totalRevenue - totalCOGS;', "totalCOGS += brewRefundCost_(dateFrom,dateTo,'ALL');\n    var grossProfit = totalRevenue - totalCOGS;");
  once("var cogs = sum_(rows,'cogs');", "var cogs = sum_(rows,'cogs') + brewRefundCost_(dateFrom,dateTo,brand);");
  once('var gp=net-cogs', "cogs+=brewRefundCost_(date,date,'ALL');\n  var gp=net-cogs");
  once("var todayUsage = todayOrders.reduce(function(s,o){ return s + Number(o.cogs || 0); }, 0);", "var todayUsage = todayOrders.reduce(function(s,o){ return s + Number(o.cogs || 0); }, 0)+brewRefundCost_(today,today,'ALL');");
  once("var todayProfit = sumField(todayScope, 'gross_profit');", "var todayProfit = sumField(todayScope, 'gross_profit')-brewRefundCost_(todayKey,todayKey,brandFilter);");
  once("var todayCogs = sumField(todayScope, 'cogs');", "var todayCogs = sumField(todayScope, 'cogs')+brewRefundCost_(todayKey,todayKey,brandFilter);");
  once("Math.round(sumField(dayOrders, 'cogs'))", "Math.round(sumField(dayOrders, 'cogs')+brewRefundCost_(dKey,dKey,brandFilter))");
  once("Math.round(sumField(dayOrders, 'gross_profit'))", "Math.round(sumField(dayOrders, 'gross_profit')-brewRefundCost_(dKey,dKey,brandFilter))");
  for(const [group,brand,from] of [['bbToday','BB','todayKey'],['hhToday','HH','todayKey'],['periodBbOrders','BB','periodStartKey'],['periodHhOrders','HH','periodStartKey']]){
    once("Math.round(sumField("+group+",'cogs'))", "Math.round(sumField("+group+",'cogs')+brewRefundCost_("+from+",todayKey,'"+brand+"'))");
    once("Math.round(sumField("+group+",'gross_profit'))", "Math.round(sumField("+group+",'gross_profit')-brewRefundCost_("+from+",todayKey,'"+brand+"'))");
  }
  // Important: expose read failures, not false zero dashboards/inventory totals.
  once("Logger.log('getDashboardSummary error: ' + e.message);", "throw e; // Do not conceal failed accounting reads as zero sales.");
  once("Logger.log('getInventoryStats error: ' + e.message);", "throw e; // Do not conceal failed accounting reads as zero usage.");
  once("Logger.log('getOrdersFromSheet error: ' + e.message);", "throw e; // A report must not silently omit failed sales reads.");
  once("Logger.log('getFinanceSummary FAST error: ' + e.message + '\\n' + (e.stack || ''));", "throw e; // Preserve an unavailable result, not a false zero P&L.");
  once("accounting_mode: 'HYBRID_AUDITED_BOM_WAC_EXPENSES_ASSETS',", "refund_consumed_cost: brewRefundCost_(periodStartKey,todayKey,brandFilter),\n      accounting_mode: 'HYBRID_AUDITED_BOM_WAC_EXPENSES_ASSETS_REFUNDS',");
  const modules=['refund-plan.js','refund-commit.js','refund-batch.js','refund-report.js','refund-service.gs','refund-integration.gs','refund-runtime-test.gs','refund-admin.gs'];
  const combined=source+'\n\n'+modules.map(f=>fs.readFileSync(path.join(__dirname,f),'utf8')).join('\n\n')+'\n'+wrappers.join('\n')+'\n';
  const out=combined+'\nvar BREWOS_REFUND_RELEASE_ID='+JSON.stringify(crypto.createHash('sha256').update(combined).digest('hex'))+';\n';
  new vm.Script(out);return out;
}
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output||path.resolve(input)===path.resolve(output))throw Error('Supply distinct baseline and output paths');fs.writeFileSync(output,build(fs.readFileSync(input,'utf8')));console.log('Validated release built: '+output);}
module.exports={build,writers,readers};
