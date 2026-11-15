// Derive a private staging backend from the exact released candidate.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),vm=require('node:vm');
function build(source,scriptId){
 if(!/^[\w-]{30,}$/.test(scriptId))throw Error('Invalid staging project ID');
 if(!source.includes('var BREWOS_RECIPE_RELEASE_ID="2a0e10a901712ff79912aecb23de636d64fc48c6c76c9a6bd43c98331c6a7a6b"'))throw Error('Expected released 6.2.7');
 const marker=source.lastIndexOf('\nvar BREWOS_RECIPE_RELEASE_ID=');
 if(crypto.createHash('sha256').update(source.slice(0,marker)).digest('hex')!=='2a0e10a901712ff79912aecb23de636d64fc48c6c76c9a6bd43c98331c6a7a6b')throw Error('Source fingerprint changed');
 const ids=[...source.matchAll(/SPREADSHEET_ID: '([^']+)'/g)];if(ids.length!==1)throw Error('Ambiguous config');
 const productionId=ids[0][1];source=source.replace(ids[0][0],"get SPREADSHEET_ID(){return brewStageSheetId_();}");
 source=source.replace('function doGet(e) {','function doGet(e) {\n  brewStageAssertReady_();');
 source=source.replace('function doPost(e) {','function doPost(e) {\n  brewStageAssertReady_();');
 source=source.replace('pong: true, version: CONFIG.VERSION','pong: true, environment:"staging", fixture:"synthetic-v1", version: CONFIG.VERSION');
 // Independent QA can count persisted events for its synthetic DUAL receipt.
 source=source.replace('      get_kitchen_queue:', "      get_qa_dual_events: function() { return brewKitchenEvents_(SpreadsheetApp.openById(brewStageSheetId_())).rows.filter(function(row){return row.order_id==='RCP-E2E2-DUAL-10f2848364ca';}); },\n      get_kitchen_queue:");
 if(source.includes(productionId))throw Error('Production reference retained');
 source+='\nvar BREWOS_STAGE_PROJECT='+JSON.stringify(scriptId)+';\n'+
 "function brewStageAssertProject_(){if(ScriptApp.getScriptId()!==BREWOS_STAGE_PROJECT)throw Error('STAGING_PROJECT_MISMATCH');}\n"+
 "function brewStageSheetId_(){brewStageAssertProject_();var id=PropertiesService.getScriptProperties().getProperty('BREWOS_STAGE_SHEET');if(!id)throw Error('STAGING_NOT_INITIALIZED');return id;}\n"+
 "function brewStageAssertReady_(){brewStageAssertProject_();if(PropertiesService.getScriptProperties().getProperty('BREWOS_STAGE_READY')!=='6.2.7')throw Error('STAGING_NOT_READY');}\n"+
 fs.readFileSync(path.join(__dirname,'bootstrap.gs'),'utf8');new vm.Script(source);return source;
}
if(require.main===module){const [input,output,id]=process.argv.slice(2);fs.writeFileSync(output,build(fs.readFileSync(input,'utf8'),id),{flag:'wx'});}
module.exports={build};
