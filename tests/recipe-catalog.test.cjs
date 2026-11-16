const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function fixture(){
 const data={ingredients:[['ingredient_id','name','unit','current_stock','unit_cost'],['RAW','Synthetic flour','g',1000,0.1],['WATER','Synthetic water','ml',5000,0.01]],
  sub_recipes:[['product_id','product_name','ingredient_id','qty_used','unit','batch_yield_qty','batch_yield_unit'],['SUB-001','Synthetic sauce','RAW',0.5,'kg',400,'g']],
  products:[['product_id','name','base_price','bom_status','bom_note','bom_cost_current','bom_last_audited'],['P','Synthetic meal',200,'READY','old',12,'2026-01-01'],['Q','Other meal',50,'READY','old',10,'2026-01-01']],
  recipe_ingredients:[['product_id','product_name','ingredient_id','ingredient_name','qty_used','unit'],['P','Synthetic meal','RAW','Synthetic flour',0.5,'kg'],[],['Q','Other meal','WATER','Synthetic water',20,'ml'],['P','Synthetic meal','WATER','Synthetic water',0.1,'l']]};
 const names=Object.keys(data),ids=Object.fromEntries(names.map((n,i)=>[n,i+1]));let batches=[],reject=false;
 const book={getSheetByName:n=>data[n]?{getSheetId:()=>ids[n],getDataRange:()=>({getValues:()=>structuredClone(data[n])}),deleteRow(){throw Error('NON_ATOMIC_DELETE');},appendRow(){throw Error('NON_ATOMIC_APPEND');}}:null};
 const ctx=vm.createContext({console,CONFIG:{SPREADSHEET_ID:'synthetic'},SpreadsheetApp:{openById:()=>book},Logger:{log(){}},isBomReadyStatus_:s=>['READY','READY_MODIFIER'].includes(s),
  convertInventoryQty_:(q,a,b)=>a===b?q:(a==='kg'&&b==='g'||a==='l'&&b==='ml')?q*1000:null,
  Sheets:{Spreadsheets:{batchUpdate(batch){batches.push(batch);if(reject)throw Error('ATOMIC_REJECT');const draft=structuredClone(data);
   for(const r of batch.requests){const x=r.deleteDimension||r.appendCells||r.updateCells,sid=x.sheetId??x.range?.sheetId??x.start?.sheetId,n=names.find(n=>ids[n]===sid);const val=c=>c.userEnteredValue.numberValue??c.userEnteredValue.stringValue;
    if(r.deleteDimension)draft[n].splice(x.range.startIndex,x.range.endIndex-x.range.startIndex);
    if(r.appendCells)x.rows.forEach(row=>draft[n].push(row.values.map(val)));
    if(r.updateCells)draft[n][x.start.rowIndex][x.start.columnIndex]=val(x.rows[0].values[0]);
   }Object.assign(data,draft);
  }}}});
 if(process.env.BREWOS_CATALOG_BASELINE)vm.runInContext(fs.readFileSync(process.env.BREWOS_CATALOG_BASELINE,'utf8'),ctx);
 else for(const f of ['recipe-stock-plan.js','recipe-stock-adapter.gs','recipe-catalog.gs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../backend',f),'utf8'),ctx);
 return {data,ctx,book,batches,reject:()=>reject=true,info:()=>ctx.buildCurrentProductCostInfoMap(book),recipes:()=>ctx.getRecipesWithCost({}),save:(lines=[{ingredient_id:'RAW',qty_used:0.25,unit:'kg'}])=>ctx.brewRefundOriginal_createRecipeLines_({product_id:'P',product_name:'Untrusted name',lines})};
}
test('0.5 kg flour plus 0.1 l water costs 51, matching sale expansion rather than 0.051',()=>{const h=fixture();assert.equal(h.info().P.cost,51);const plan=h.ctx.brewRecipePlanItems_(h.ctx.brewRecipeSnapshot_(h.book),[{id:'P',qty:1,_resolved_modifiers:[]}]);assert.equal(h.info().P.cost,plan.items[0].cost_per_item);});
test('recipe API preserves kg alongside 0.5 quantity and prices that display unit',()=>{const r=fixture().recipes()[0];assert.equal(r.cost,51);assert.equal(r.lines[0].unit,'kg');assert.equal(r.lines[0].qty,0.5);assert.equal(r.lines[0].unit_cost,100);assert.equal(r.lines[0].line_cost,50);});
test('subrecipe uses batch yield and normalized raw quantities exactly once',()=>{const h=fixture();h.data.recipe_ingredients[1][2]='SUB-001';h.data.recipe_ingredients[1][4]=80;h.data.recipe_ingredients[1][5]='g';assert.equal(h.info().P.cost,11);assert.equal(h.recipes()[0].lines[0].name,'Synthetic sauce');});
test('missing, cyclic and incompatible components never appear as complete or free recipes',()=>{
 for(const change of [h=>h.data.recipe_ingredients[1][2]='UNKNOWN',h=>h.data.recipe_ingredients[1][5]='ml',h=>{h.data.recipe_ingredients[1][2]='SUB-001';h.data.recipe_ingredients[1][5]='g';h.data.sub_recipes[1][2]='SUB-001';h.data.sub_recipes[1][4]='g';}]){
  const h=fixture();change(h);assert.equal(h.info().P.complete,false);const r=h.recipes()[0];assert.equal(r.cost,null);assert.equal(r.cost_complete,false);assert(r.cost_error);assert.equal(h.info().Q.complete,true);
 }
});
test('zero-cost ingredient is valid; REVIEW BOM stays nonauthoritative',()=>{const h=fixture();h.data.ingredients[1][4]=0;assert.equal(h.info().P.cost,1);h.data.products[1][3]='REVIEW';assert.equal(h.info().P.complete,false);assert.equal(h.info().P.structural_complete,true);});
test('partial, invalid, duplicate or unknown lines make zero writes and preserve the original recipe',()=>{
 for(const bad of [{ingredient_id:'WATER',qty_used:'' ,unit:'ml'},{ingredient_id:'WATER',qty_used:Infinity,unit:'ml'},{ingredient_id:'WATER',qty_used:[1],unit:'ml'},{ingredient_id:'WATER',qty_used:0,unit:'ml'},{ingredient_id:'WATER',qty_used:-1,unit:'ml'},{ingredient_id:'WATER',qty_used:true,unit:'ml'},{ingredient_id:'UNKNOWN',qty_used:1,unit:'g'},{ingredient_id:'RAW',qty_used:1,unit:'g'},{ingredient_id:'WATER',qty_used:1,unit:'g'}]){
  const h=fixture(),before=JSON.stringify(h.data);assert.equal(h.save([{ingredient_id:'RAW',qty_used:1,unit:'g'},bad]).success,false);assert.equal(h.batches.length,0);assert.equal(JSON.stringify(h.data),before);
 }
});
test('atomic recipe replacement uses real row indices and marks only that product REVIEW',()=>{const h=fixture();const other=JSON.stringify(h.data.products[2]);assert.equal(h.save().success,true);assert.equal(h.batches.length,1);assert.deepEqual(Array.from(h.batches[0].requests.filter(r=>r.deleteDimension),r=>r.deleteDimension.range.startIndex),[4,1]);const lines=h.data.recipe_ingredients.filter(r=>r[0]==='P');assert.equal(lines.length,1);assert.equal(lines[0][1],'Synthetic meal');assert.equal(lines[0][4],0.25);assert.equal(lines[0][5],'kg');assert.equal(h.data.products[1][3],'REVIEW');assert.equal(h.data.products[1][5],'');assert.equal(JSON.stringify(h.data.products[2]),other);assert.equal(h.data.recipe_ingredients.filter(r=>r[0]==='Q').length,1);});
test('batch rejection preserves old BOM and READY status together',()=>{const h=fixture(),before=JSON.stringify(h.data);h.reject();assert.equal(h.save().success,false);assert.equal(h.batches.length,1);assert.equal(JSON.stringify(h.data),before);});
test('missing review schema refuses replacement instead of saving an authoritative partial recipe',()=>{const h=fixture();h.data.products[0][3]='unknown';const before=JSON.stringify(h.data);assert.equal(h.save().success,false);assert.equal(h.batches.length,0);assert.equal(JSON.stringify(h.data),before);});
test('empty recipes and duplicate product IDs fail before writes',()=>{const h=fixture();assert.equal(h.save([]).success,false);h.data.products.push(h.data.products[1].slice());assert.equal(h.save().success,false);assert.equal(h.batches.length,0);});
