// Read-only server adapter; no stock writes, activation or schema creation.
function brewRecipeTable_(ss, name) {
  var sh=ss.getSheetByName(name);
  if(!sh)throw Error('RECIPE_SCHEMA_MISSING_'+name);
  var data=sh.getDataRange().getValues(),headers=(data[0]||[]).map(function(h){return String(h||'').trim();});
  if(!headers.length||headers.some(function(h){return !h;})||new Set(headers).size!==headers.length)throw Error('RECIPE_SCHEMA_INVALID_'+name);
  return {sheet:sh,headers:headers,rows:data.slice(1).filter(function(row){return row.some(function(v){return v!=='';});}).map(function(row){
    var out={};headers.forEach(function(h,i){out[h]=row[i];});return out;
  })};
}
function brewRecipeSnapshot_(ss) {
  var ingredients=brewRecipeTable_(ss,'ingredients').rows.filter(function(i){return !/^SUB-/.test(String(i.ingredient_id||'').trim());});
  var rawSubs=brewRecipeTable_(ss,'sub_recipes').rows,bySub=new Map(),units=new Map();
  ingredients.forEach(function(i){var id=String(i.ingredient_id||'').trim();if(!id||units.has(id))throw Error('DUPLICATE_INGREDIENT_ID_'+id);units.set(id,String(i.unit||'').trim());});
  rawSubs.forEach(function(row){
    var id=String(row.product_id||'').trim();
    // Existing human-readable subtotal rows are not recipe components.
    if(/^รวม SUB-\d+$/.test(id)&&String(row.ingredient_id||'').trim()===''&&row.qty_used==='')return;
    if(!/^SUB-\d+$/.test(id))throw Error('INVALID_SUBRECIPE_ID_'+id);
    var def=bySub.get(id),unit=String(row.batch_yield_unit||'').trim();
    if(!def){def={product_id:id,yield_qty:row.batch_yield_qty,yield_unit:unit,lines:[]};bySub.set(id,def);units.set(id,unit);}
    if(Number(row.batch_yield_qty)!==Number(def.yield_qty)||unit!==def.yield_unit)throw Error('INCONSISTENT_BATCH_YIELD_'+id);
    def.lines.push(row);
  });
  function requirement(row,qty) {
    var id=String(row.ingredient_id||'').trim(),from=String(row.unit||'').trim(),to=units.get(id);
    if(!from||!to)throw Error('MISSING_RECIPE_UNIT_OR_INGREDIENT_'+id);
    if(qty===''||qty===null||qty===undefined||typeof qty==='boolean'||!isFinite(Number(qty))||Number(qty)<=0)throw Error('INVALID_RECIPE_QUANTITY_'+id);
    var converted=convertInventoryQty_(Number(qty),from,to);
    if(converted===null)throw Error('RECIPE_UNIT_MISMATCH_'+id+'_'+from+'_'+to);
    return {ingredient_id:id,qty:converted,unit:to};
  }
  // A draft subrecipe may refer to ingredients not created yet. Keep its error
  // attached to that recipe; unrelated ready products must remain sellable.
  bySub.forEach(function(def){
    try{def.lines=def.lines.map(function(row){return requirement(row,row.qty_used);});}
    catch(e){def.validation_error=e.message;def.lines=[];}
  });
  return {snapshot:{ingredients:ingredients,subrecipes:Array.from(bySub.values()),consumption_mode:'raw_at_sale',cutover_confirmed:true},
    recipes:brewRecipeTable_(ss,'recipe_ingredients').rows,products:brewRecipeTable_(ss,'products').rows,requirement:requirement};
}
function brewRecipePlanItems_(context,items) {
  var products=new Map(),requirements=[],perItem=[];
  context.products.forEach(function(p){var id=String(p.product_id||'').trim();if(products.has(id))throw Error('DUPLICATE_PRODUCT_ID_'+id);products.set(id,p);});
  items.forEach(function(item){
    var pid=String(item.id||item.product_id||'').trim(),p=products.get(pid),qty=Number(item.qty);
    if(!p||!isBomReadyStatus_(p.bom_status))throw Error('BOM_NOT_READY_'+pid);
    if(!Number.isInteger(qty)||qty<1||qty>999)throw Error('INVALID_ORDER_QUANTITY_'+pid);
    var lines=context.recipes.filter(function(r){return String(r.product_id||'').trim()===pid;});
    if(!lines.length)throw Error('MISSING_RECIPE_'+pid);
    if(!Array.isArray(item._resolved_modifiers))throw Error('SERVER_MODIFIERS_NOT_RESOLVED_'+pid);
    var one=lines.concat(item._resolved_modifiers).map(function(row){return context.requirement(row,row.qty_used);});
    var per=BrewRecipeStockPlan.build(context.snapshot,one);
    perItem.push({product_id:pid,cost_per_item:per.total_cost});
    one.forEach(function(r){requirements.push({ingredient_id:r.ingredient_id,qty:r.qty*qty,unit:r.unit});});
  });
  return {stock:BrewRecipeStockPlan.build(context.snapshot,requirements),items:perItem};
}
