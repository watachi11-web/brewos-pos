const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../recipe.html'),'utf8');
function setup(){
 const elements=new Map(),calls=[],messages=[];
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',style:{},options:[{getAttribute:()=> 'Synthetic menu'}],selectedIndex:0});return elements.get(id);};
 const ctx=vm.createContext({console,document:{getElementById:el},UI:{toast:m=>messages.push(m),loading(){},openModal(){}},API:{products:async()=>[{product_id:'DRAFT',name:'Draft & <menu>',is_available:false},{product_id:'DELETED',name:'Deleted',is_deleted:true}],ingredients:async()=>[],createRecipe:async p=>{calls.push(p);return {success:true};}},closeAddRecipeModal(){},loadRecipeData:async()=>{},selectRecipe(){}});
 vm.runInContext('let RECIPES=[]; let ALL_PRODUCTS=[];'+html.slice(html.indexOf('let ALL_INGREDIENTS ='),html.lastIndexOf("document.addEventListener('DOMContentLoaded'")),ctx);
 const run=s=>vm.runInContext(s,ctx);
 run("ALL_INGREDIENTS=[{ingredient_id:'I',name:'Synthetic flour',unit:'g'},{ingredient_id:'J',name:'Synthetic water',unit:'ml'}]; ALL_PRODUCTS=[{product_id:'A',name:'Synthetic menu'},{product_id:'B',name:'New menu'}]; RECIPES=[{product_id:'A',lines:[{ingredient_id:'I',qty:0.5,unit:'kg'}]}]; closeAddRecipeModal=()=>{};");
 el('ar-product').value='A';return {el,run,calls,messages};
}
test('switching to a menu without a recipe clears the previous BOM',()=>{const h=setup();h.run('onProductSelected()');h.el('ar-product').value='B';h.run('onProductSelected()');assert(!h.run('formLines.some(l=>l.ingredient_id)'));});
test('opening and saving an existing converted-unit recipe preserves quantity and unit',async()=>{const h=setup();h.run('onProductSelected()');await h.run('saveRecipeForm()');assert.equal(h.calls[0].lines[0].qty_used,0.5);assert.equal(h.calls[0].lines[0].unit,'kg');});
test('partial, non-finite, unknown and duplicate lines block the entire save',async()=>{
 for(const bad of [{ingredient_id:'J',qty:''},{ingredient_id:'J',qty:'Infinity'},{ingredient_id:'UNKNOWN',qty:1},{ingredient_id:'I',qty:2},{ingredient_id:'J',qty:-1},{ingredient_id:'',qty:2}]){
  const h=setup();h.run("formLines=[{ingredient_id:'I',qty:2,unit:'g'}]");h.run('formLines.push('+JSON.stringify(bad)+')');await h.run('saveRecipeForm()');assert.equal(h.calls.length,0,JSON.stringify(bad));
 }
});
test('changing ingredient resets its quantity and updates displayed unit',()=>{const h=setup();h.run('onProductSelected(); updateLineIngredient(0,"J")');assert.equal(h.run('formLines[0].qty'),'');assert.equal(h.run('formLines[0].unit'),'ml');assert(h.el('ar-lines').innerHTML.includes('ml'));});
test('subrecipe definition takes precedence over legacy pseudo ingredient in lookup and options',()=>{const h=setup();h.run("ALL_INGREDIENTS.push({ingredient_id:'SUB-001',name:'Legacy',unit:'ml'}); ALL_SUB_RECIPES=[{ingredient_id:'SUB-001',name:'Synthetic sauce',unit:'g'}]");assert.equal(h.run('findIngredientOrSub("SUB-001").unit'),'g');assert.equal((h.run('ingredientOptionsHtml("")').match(/value="SUB-001"/g)||[]).length,1);});
test('a fully blank added row is harmless; valid independent quantities survive',async()=>{const h=setup();h.run("formLines=[{ingredient_id:'I',qty:2,unit:'g'},{ingredient_id:'',qty:''}]");await h.run('saveRecipeForm()');assert.equal(h.calls.length,1);assert.equal(h.calls[0].lines.length,1);});

test('recipe editor includes inactive drafts for repair, excludes deleted menus and escapes names',async()=>{const h=setup();await h.run('openAddRecipeModal()');const html=h.el('ar-product').innerHTML;assert(html.includes('DRAFT'));assert(!html.includes('DELETED'));assert(html.includes('Draft &amp; &lt;menu&gt;'));});
