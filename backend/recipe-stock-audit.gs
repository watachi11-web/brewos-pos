// Read-only audit; run inside an editor wrapper with the reviewed planner/adapter.
function brewRecipeAudit_(){
  var ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID),context=brewRecipeSnapshot_(ss),config=buildModifierConfig_(ss),results=[];
  context.products.forEach(function(p){
    if(isFalse(p.is_available)||isTrue(p.is_deleted))return;
    var variants=[{label:'default',modifiers:[]}];
    (config.byProduct[p.product_id]||[]).forEach(function(g){g.options.forEach(function(o){variants.push({label:o.option_id,modifiers:[{group_id:g.group_id,option_id:o.option_id}]});});});
    variants.forEach(function(v){
      var item={id:p.product_id,name:p.name,qty:1,modifiers:v.modifiers},out={product_id:p.product_id,name:p.name,variant:v.label};
      try{item._resolved_modifiers=resolveItemModifiers_(item,p.product_id,config,true).selections;
        var plan=brewRecipePlanItems_(context,[item]);out.cost=plan.items[0].cost_per_item;
        out.shortages=plan.stock.stock_moves.filter(function(m){return m.shortage>0;}).map(function(m){return {ingredient_id:m.ingredient_id,shortage:m.shortage};});
      }catch(e){out.error=e.message;}
      results.push(out);
    });
  });
  var summary={at:new Date().toISOString(),products:results.filter(function(r){return r.variant==='default';}).length,variants:results.length,errors:results.filter(function(r){return r.error;}),draft_subrecipes:context.snapshot.subrecipes.filter(function(s){return s.validation_error;}).map(function(s){return {id:s.product_id,error:s.validation_error};})};
  console.log('RECIPE_AUDIT_SUMMARY '+JSON.stringify(summary));
  results.forEach(function(r){console.log('RECIPE_AUDIT_ITEM '+JSON.stringify(r));});return summary;
}
