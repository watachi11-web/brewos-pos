// Editor-only initializer. Never exposed as an HTTP route. Creates synthetic data once.
function initializeStaging(){
 brewStageAssertProject_();var props=PropertiesService.getScriptProperties();
 if(props.getProperty('BREWOS_STAGE_SHEET'))throw Error('ALREADY_INITIALIZED_DO_NOT_RESET');
 var ss=SpreadsheetApp.create('[STAGING ONLY] BrewOS QA synthetic 6.2.7');ss.setSpreadsheetTimeZone('Asia/Bangkok');
 props.setProperty('BREWOS_STAGE_SHEET',ss.getId());
 var fixture={
  orders:[BrewSaleBatch.columns.orders],order_lines:[BrewSaleBatch.columns.order_lines],order_line_modifiers:[BrewSaleBatch.columns.order_line_modifiers],sale_operations:[BrewSaleBatch.columns.sale_operations],refund_operations:[BrewRefundBatch.operationHeaders],kitchen_events:[BREWOS_KITCHEN_HEADERS],
  product_categories:[['category_id','brand_id','name','name_th','is_active','display_order'],['CAT-QA-HH','HH','QA Food','อาหารทดสอบ',true,1],['CAT-QA-BB','BB','QA Drinks','เครื่องดื่มทดสอบ',true,2]],
  products:[['product_id','name','name_th','brand_id','category_id','base_price','cost_price','is_available','is_deleted','bom_status'],['PRD-001','QA Food','อาหารทดสอบ','HH','CAT-QA-HH',30,14.5,true,false,'READY'],['PRD-002','QA Coffee','กาแฟทดสอบ','BB','CAT-QA-BB',40,4,true,false,'READY']],
  ingredients:[['ingredient_id','name','brand_id','category','unit','current_stock','min_stock','unit_cost'],['ING-001','QA raw ingredient','SHARED','ingredient','g',100000,100,0.1],['PKG-001','QA package','SHARED','packaging','pcs',1000,10,2]],
  recipe_ingredients:[['product_id','ingredient_id','qty_used','unit'],['PRD-001','SUB-001',100,'g'],['PRD-001','PKG-001',1,'pcs'],['PRD-002','ING-001',20,'g'],['PRD-002','PKG-001',1,'pcs']],
  sub_recipes:[['product_id','ingredient_id','qty_used','unit','batch_yield_qty','batch_yield_unit'],['SUB-001','ING-001',500,'g',400,'g']],
  customers:[['customer_id','full_name','brand_id','phone','email','is_active','is_deleted','tier','points','total_spent','visit_count','notes','created_at'],['CUS-001','QA <Example & Co.>','SHARED','0000000001','qa@example.invalid',true,false,'Bronze',0,0,0,'Synthetic only','2026-10-31'],['CUS-002','QA Inactive','SHARED','0000000002','',false,false,'Bronze',0,0,0,'Synthetic only','2026-10-31'],['CUS-003','QA Deleted','SHARED','0000000003','',true,true,'Bronze',0,0,0,'Synthetic only','2026-10-31'],['CUS-004','QA HH Only','HH','0000000004','',true,false,'Bronze',0,0,0,'Synthetic only','2026-10-31']],
  brands:[['brand_id','name','is_active'],['HH','QA Heng Heng',true],['BB','QA Brain Brew',true]],
  settings:[['key','value'],['store_name','STAGING ONLY — SYNTHETIC DATA']],
  modifier_groups:[['group_id','name','required','min_select','max_select','is_active'],['MG-QA','QA optional extra',false,0,1,true]],
  modifier_options:[['option_id','group_id','name','ingredient_id','qty_used','unit','price_delta','is_default','is_active'],['MO-QA','MG-QA','QA extra ingredient','ING-001',10,'g',5,false,true]],
  product_modifier_groups:[['product_id','group_id','is_active'],['PRD-002','MG-QA',true]]
 };
 Object.keys(fixture).forEach(function(name){var sh=ss.insertSheet(name);sh.getRange(1,1,fixture[name].length,fixture[name][0].length).setValues(fixture[name]);sh.setFrozenRows(1);});
 SpreadsheetApp.flush();brewRefundOriginal_ensureAccountingSchema_();
 props.setProperty('BREWOS_REFUND_ENABLED','v1');props.setProperty('BREWOS_SALE_ENABLED_'+ss.getId(),'raw-at-sale-v1');
 props.setProperty('BREWOS_STAGE_READY','6.2.7');
 console.log('STAGING_READY '+JSON.stringify({sheet:ss.getId(),script:ScriptApp.getScriptId(),environment:'staging',production_data_copied:false}));
}
