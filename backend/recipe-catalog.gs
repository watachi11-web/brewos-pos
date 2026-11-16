// Candidate read model and atomic recipe editor. All costing uses the same
// normalized requirements and raw expansion as sales. No activation or migration.
function brewRecipePreview_(context, productId) {
  var rows=context.recipes.filter(function(r){return String(r.product_id||'').trim()===productId;});
  if(!rows.length)throw Error('MISSING_RECIPE_'+productId);
  var ingredients=new Map(context.snapshot.ingredients.map(function(i){return [String(i.ingredient_id).trim(),i];}));
  var subs=new Map(context.snapshot.subrecipes.map(function(s){return [s.product_id,s];}));
  var requirements=rows.map(function(r){return context.requirement(r,r.qty_used);});
  var total=BrewRecipeStockPlan.build(context.snapshot,requirements).total_cost;
  return {cost:total,lines:rows.map(function(row,i){
    var id=String(row.ingredient_id).trim(),sub=subs.get(id),ing=ingredients.get(id);
    var cost=BrewRecipeStockPlan.build(context.snapshot,[requirements[i]]).total_cost;
    return {ingredient_id:id,name:(sub&&sub.name)||(ing&&ing.name)||id,
      // Quantity, display unit and price per display unit must describe the same measure.
      qty:Number(row.qty_used),unit:String(row.unit).trim(),stock_unit:requirements[i].unit,unit_cost:cost/Number(row.qty_used),
      is_sub_recipe:!!sub,line_cost:Math.round(cost*100)/100};
  })};
}
function buildCurrentProductCostInfoMap(ss) {
  var context=brewRecipeSnapshot_(ss),out={};
  context.products.forEach(function(p){
    var id=String(p.product_id||'').trim();
    if(!id||Object.prototype.hasOwnProperty.call(out,id))throw Error('DUPLICATE_OR_MISSING_PRODUCT_ID');
    var info={cost:null,structural_complete:false,complete:false,bom_status:p.bom_status||'MISSING',bom_note:p.bom_note||'',
      audited_cost:p.bom_cost_current||0,audited_at:p.bom_last_audited||'',missing_components:[]};
    try{info.cost=brewRecipePreview_(context,id).cost;info.structural_complete=true;info.complete=isBomReadyStatus_(p.bom_status);}
    catch(e){info.cost_error=e.message;}
    out[id]=info;
  });
  return out;
}
function getRecipesWithCost(params) {
  var context=brewRecipeSnapshot_(SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)),seen=new Set();
  return context.products.filter(function(p){return context.recipes.some(function(r){return String(r.product_id||'').trim()===String(p.product_id||'').trim();});}).map(function(p){
    var id=String(p.product_id||'').trim();if(!id||seen.has(id))throw Error('DUPLICATE_OR_MISSING_PRODUCT_ID');seen.add(id);
    var price=Number(p.base_price),out={recipe_id:id,product_id:id,name:p.name,name_th:p.name_th||'',icon:p.emoji||'🍽',category:p.category_id||'',brand:p.brand_id||'',selling_price:price,
      serving:'1 serving',cost:null,gp_percent:null,cost_complete:false,lines:[]};
    try{
      var preview=brewRecipePreview_(context,id);out.lines=preview.lines;out.cost=Math.round(preview.cost*100)/100;
      out.gp_percent=price>0?Math.round((price-preview.cost)/price*1000)/10:0;out.cost_complete=true;
    }catch(e){
      out.cost_error=e.message;
      // Keep the recipe editable without turning invalid/unknown components into free stock.
      out.lines=context.recipes.filter(function(r){return String(r.product_id||'').trim()===id;}).map(function(r){
        return {ingredient_id:String(r.ingredient_id||'').trim(),name:r.ingredient_name||r.ingredient_id,qty:r.qty_used,unit:r.unit,
          is_sub_recipe:context.snapshot.subrecipes.some(function(s){return s.product_id===String(r.ingredient_id||'').trim();}),unit_cost:null,line_cost:null};
      });
    }
    return out;
  });
}
function brewRefundOriginal_createRecipeLines_(body) {
  try{
    var ss=SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID),context=brewRecipeSnapshot_(ss);
    var id=String((body||{}).product_id||'').trim(),lines=(body||{}).lines;
    var products=context.products.filter(function(p){return String(p.product_id||'').trim()===id;});
    if(!id||products.length!==1)throw Error('UNKNOWN_OR_DUPLICATE_PRODUCT');
    if(!Array.isArray(lines)||!lines.length)throw Error('EMPTY_RECIPE');
    var seen=new Set(),requirements=[];
    var canonical=lines.map(function(line){
      if(!line||typeof line!=='object')throw Error('INVALID_RECIPE_LINE');
      var requirement=context.requirement(line,line.qty_used),iid=requirement.ingredient_id;
      if(seen.has(iid))throw Error('DUPLICATE_RECIPE_COMPONENT_'+iid);seen.add(iid);requirements.push(requirement);
      var component=context.snapshot.ingredients.find(function(i){return String(i.ingredient_id||'').trim()===iid;})||context.snapshot.subrecipes.find(function(s){return s.product_id===iid;});
      return {product_id:id,product_name:products[0].name,ingredient_id:iid,ingredient_name:component.name||iid,qty_used:Number(line.qty_used),unit:String(line.unit).trim()};
    });
    BrewRecipeStockPlan.build(context.snapshot,requirements);
    var recipe=brewRecipeTable_(ss,'recipe_ingredients'),productTable=brewRecipeTable_(ss,'products');
    ['product_id','product_name','ingredient_id','ingredient_name','qty_used','unit'].forEach(function(h){if(recipe.headers.indexOf(h)<0)throw Error('RECIPE_SCHEMA_MISSING_COLUMN_'+h);});
    ['product_id','bom_status','bom_note','bom_cost_current','bom_last_audited'].forEach(function(h){if(productTable.headers.indexOf(h)<0)throw Error('PRODUCT_SCHEMA_MISSING_COLUMN_'+h);});
    var recipeValues=recipe.sheet.getDataRange().getValues(),productValues=productTable.sheet.getDataRange().getValues();
    var requests=[],idColumn=recipe.headers.indexOf('product_id');
    // Delete bottom-up using physical row indices, including any blank rows.
    for(var row=recipeValues.length-1;row>0;row--)if(String(recipeValues[row][idColumn]||'').trim()===id)requests.push({deleteDimension:{range:{sheetId:recipe.sheet.getSheetId(),dimension:'ROWS',startIndex:row,endIndex:row+1}}});
    function cell(value){return {userEnteredValue:typeof value==='number'?{numberValue:value}:{stringValue:String(value==null?'':value)}};}
    requests.push({appendCells:{sheetId:recipe.sheet.getSheetId(),rows:canonical.map(function(r){return {values:recipe.headers.map(function(h){return cell(r[h]);})};}),fields:'userEnteredValue'}});
    var productRow=productValues.findIndex(function(r,index){return index>0&&String(r[productTable.headers.indexOf('product_id')]||'').trim()===id;});
    if(productRow<1)throw Error('PRODUCT_ROW_MISSING');
    var changes={bom_status:'REVIEW',bom_note:'สูตรมีการแก้ไขผ่าน Recipe editor — ต้อง audit ก่อนใช้ BOM เป็น authoritative',bom_cost_current:'',bom_last_audited:''};
    Object.keys(changes).forEach(function(key){requests.push({updateCells:{start:{sheetId:productTable.sheet.getSheetId(),rowIndex:productRow,columnIndex:productTable.headers.indexOf(key)},rows:[{values:[cell(changes[key])]}],fields:'userEnteredValue'}});});
    // The existing createRecipeLines wrapper holds the shared sale/refund lock.
    // Formula replacement and REVIEW status succeed or fail in one Sheets batch.
    Sheets.Spreadsheets.batchUpdate({requests:requests},CONFIG.SPREADSHEET_ID);
    return {success:true,product_id:id,lines_added:canonical.length,bom_status:'REVIEW'};
  }catch(e){return {success:false,error:e.message};}
}
