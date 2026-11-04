// Derive a private staging backend from the exact released candidate.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),vm=require('node:vm');
function build(source,scriptId){
 if(!/^[\w-]{30,}$/.test(scriptId))throw Error('Invalid staging project ID');
 if(!source.includes('var BREWOS_RECIPE_RELEASE_ID="86b1276152041fdeddc83aa6f5f7ee9d968f47f0871f6e129c18c44cd3f0ae76"'))throw Error('Expected released 6.2.7');
 const marker=source.lastIndexOf('\nvar BREWOS_RECIPE_RELEASE_ID=');
 if(crypto.createHash('sha256').update(source.slice(0,marker)).digest('hex')!=='86b1276152041fdeddc83aa6f5f7ee9d968f47f0871f6e129c18c44cd3f0ae76')throw Error('Source fingerprint changed');
 const ids=[...source.matchAll(/SPREADSHEET_ID: '([^']+)'/g)];if(ids.length!==1)throw Error('Ambiguous config');
 const productionId=ids[0][1];source=source.replace(ids[0][0],"get SPREADSHEET_ID(){return brewStageSheetId_();}");
 source=source.replace('function doGet(e) {','function doGet(e) {\n  brewStageAssertReady_();');
 source=source.replace('function doPost(e) {','function doPost(e) {\n  brewStageAssertReady_();');
 source=source.replace('pong: true, version: CONFIG.VERSION','pong: true, environment:"staging", fixture:"synthetic-v1", version: CONFIG.VERSION');
 if(source.includes(productionId))throw Error('Production reference retained');
 source+='\nvar BREWOS_STAGE_PROJECT='+JSON.stringify(scriptId)+';\n'+
 "function brewStageAssertProject_(){if(ScriptApp.getScriptId()!==BREWOS_STAGE_PROJECT)throw Error('STAGING_PROJECT_MISMATCH');}\n"+
 "function brewStageSheetId_(){brewStageAssertProject_();var id=PropertiesService.getScriptProperties().getProperty('BREWOS_STAGE_SHEET');if(!id)throw Error('STAGING_NOT_INITIALIZED');return id;}\n"+
 "function brewStageAssertReady_(){brewStageAssertProject_();if(PropertiesService.getScriptProperties().getProperty('BREWOS_STAGE_READY')!=='6.2.7')throw Error('STAGING_NOT_READY');}\n"+
 fs.readFileSync(path.join(__dirname,'bootstrap.gs'),'utf8');new vm.Script(source);return source;
}
if(require.main===module){const [input,output,id]=process.argv.slice(2);fs.writeFileSync(output,build(fs.readFileSync(input,'utf8'),id),{flag:'wx'});}
module.exports={build};
