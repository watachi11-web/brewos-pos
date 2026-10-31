function brewKitchenRuntimeTest_(){
 var production=CONFIG.SPREADSHEET_ID,ss=SpreadsheetApp.create('[TEST ONLY] Kitchen workflow '+Date.now()),checks=[];
 if(ss.getId()===production)throw Error('ISOLATION_FAILED');
 function check(label,value){if(!value)throw Error(label);checks.push(label);}
 function expect(label,fn,code){var failed=false;try{fn();}catch(e){failed=e.message.indexOf(code)>=0;}check(label,failed);}
 var date=Utilities.formatDate(new Date(),'Asia/Bangkok','yyyy-MM-dd');
 var fixture={refund_operations:[BrewRefundBatch.operationHeaders],orders:[['order_id','created_at','order_status','payment_status','brand_id','customer_name','notes'],['TEST-A',new Date(),'completed','paid','HH','Synthetic','No onions']],order_lines:[['order_id','line_id','product_name','quantity','notes'],['TEST-A','LINE-A','Synthetic food',2,'Hot']],order_line_modifiers:[['line_id','option_name'],['LINE-A','No sugar']],kitchen_events:[BREWOS_KITCHEN_HEADERS]};
 Object.keys(fixture).forEach(function(name){ss.insertSheet(name).getRange(1,1,fixture[name].length,fixture[name][0].length).setValues(fixture[name]);});SpreadsheetApp.flush();
 try{CONFIG.SPREADSHEET_ID=ss.getId();
  function queue(){return brewKitchenQueue_({date:date}).orders[0];}
  function update(status,v,n){return brewKitchenUpdate_({order_id:'TEST-A',status:status,expected_version:v,operation_id:'KDS-123456789012345'+n});}
  check('initial pending',queue().preparation_status==='pending');check('quantity and modifiers',queue().items[0].qty===2&&queue().items[0].modifiers[0]==='No sugar');
  update('making',0,1);check('reload making',queue().preparation_status==='making');
  expect('second screen stale rejected',function(){update('making',0,2);},'STATE_CHANGED');
  update('done',1,2);check('reload ready',queue().preparation_status==='done');
  check('lost reply retry',update('making',0,1).replayed===true);check('retry no duplicate',ss.getSheetByName('kitchen_events').getLastRow()===3);
  update('making',2,3);check('reopen ready',queue().preparation_version===3);
  check('accounting untouched',ss.getSheetByName('orders').getRange(2,3).getValue()==='completed');
  ss.getSheetByName('orders').getRange(2,3).setValue('cancelled');SpreadsheetApp.flush();check('cancelled visible',queue().preparation_status==='cancelled');expect('cancelled cannot change',function(){update('done',3,4);},'CANCELLED');
  var proof={passed:true,release:BREWOS_RECIPE_RELEASE_ID,checks:checks,id:ss.getId()};PropertiesService.getScriptProperties().setProperty('BREWOS_KITCHEN_LAST_TEST',JSON.stringify(proof));console.log('KITCHEN_RUNTIME_PASS '+JSON.stringify(proof));
 }finally{CONFIG.SPREADSHEET_ID=production;}
}
