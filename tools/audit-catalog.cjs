// Offline audit of existing read-only API exports. No network or write APIs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const norm=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
function audit({products,ingredients,recipes,menu}){
 const issues=[],add=(code,ids,evidence)=>issues.push({code,ids,evidence});
 function index(rows,key,label){const map=new Map();rows.forEach((r,i)=>{const id=String(r[key]??'').trim();if(!id||map.has(id))add('DUPLICATE_OR_EMPTY_ID',[id],{table:label,row:i,key});else map.set(id,r);});return map;}
 const P=index(products,'product_id','products'),I=index(ingredients,'ingredient_id','ingredients'),R=index(recipes,'product_id','recipes'),M=index(menu.products,'product_id','menu');
 function names(rows,key,label){const groups=new Map();rows.forEach(r=>{const name=norm(r.name);if(!name)return;groups.set(name,[...(groups.get(name)||[]),r[key]]);});for(const [name,ids]of groups)if(ids.length>1)add('SAME_NAME_REVIEW',ids,{table:label,name});}
 names(products,'product_id','products');names(ingredients,'ingredient_id','ingredients');
 const fingerprints=new Map(),used=new Set(),subrefs=new Set();
 for(const [id,r]of R){
  if(!P.has(id))add('ORPHAN_RECIPE',[id],{});
  const lines=r.lines||[],seen=new Set();
  if(!lines.length)add('EMPTY_RECIPE',[id],{});
  lines.forEach((l,n)=>{
   const iid=l.ingredient_id,ev={product_id:id,line:n+1,ingredient_id:iid,qty:l.qty,unit:l.unit};used.add(iid);
   if(seen.has(iid))add('REPEATED_COMPONENT',[id,iid],ev);seen.add(iid);
   if((typeof l.qty!=='number'&&typeof l.qty!=='string')||String(l.qty).trim()===''||!Number.isFinite(Number(l.qty))||Number(l.qty)<=0)add('INVALID_QUANTITY',[id,iid],ev);
   if(l.is_sub_recipe)subrefs.add(iid);else if(!I.has(iid))add('MISSING_COMPONENT',[id,iid],ev);
   if(!l.unit)add('MISSING_UNIT',[id,iid],ev);
   // API historically substitutes ingredient.unit for the source BOM unit.
   // Equality here is display agreement, not proof of raw-unit correctness.
   if(I.has(iid)&&l.unit!==I.get(iid).unit)add('DISPLAY_UNIT_DISAGREEMENT',[id,iid],{...ev,inventory_unit:I.get(iid).unit});
  });
  if(lines.length){const fp=JSON.stringify(lines.map(l=>[l.ingredient_id,Number(l.qty),l.unit]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));fingerprints.set(fp,[...(fingerprints.get(fp)||[]),id]);}
 }
 for(const ids of fingerprints.values())if(ids.length>1)add('IDENTICAL_BOM_REVIEW',ids,{});
 for(const [id,p]of P){
  if(!R.has(id))add(M.has(id)?'SELLABLE_WITHOUT_RECIPE':'INACTIVE_WITHOUT_RECIPE',[id],{bom_status:p.bom_status,is_available:p.is_available});
  if(M.has(id)){const m=M.get(id);if(Number.isFinite(Number(p.cost_price))&&Number.isFinite(Number(m.cost_price))&&Math.abs(m.cost_price-p.cost_price)>.01)add('MASTER_CURRENT_COST_DIFFERENCE',[id],{master:p.cost_price,current:m.cost_price,source:m.cost_source});}
 }
 for(const [id]of M)if(!P.has(id))add('MENU_WITHOUT_PRODUCT',[id],{});
 for(const [id,i]of I){
  if(norm(i.unit)==='oz')add('AMBIGUOUS_OZ',[id],{name:i.name,unit:i.unit,recipes:recipes.filter(r=>r.lines.some(l=>l.ingredient_id===id)).map(r=>r.product_id)});
  if(Number(i.current_stock)<0)add('NEGATIVE_STOCK',[id],{name:i.name,quantity:i.current_stock,unit:i.unit});
  if(!Number.isFinite(Number(i.unit_cost))||i.unit_cost===null||i.unit_cost===''||Number(i.unit_cost)<0)add('INVALID_UNIT_COST',[id],{unit_cost:i.unit_cost});
 }
 return {counts:{products:products.length,menu:menu.products.length,ingredients:ingredients.length,recipes:recipes.length,lines:recipes.reduce((s,r)=>s+(r.lines||[]).length,0)},issues,
  referenced_subrecipes:[...subrefs].sort(),not_directly_referenced:ingredients.filter(i=>!used.has(i.ingredient_id)).map(i=>i.ingredient_id),
  limitations:['API exports are sequential reads, not a locked database snapshot.','Raw recipe_ingredients units, sub_recipes yields/lines and modifier ingredient/qty mappings are not exposed by these exports.','Matching display units and valid positive quantities do not certify portions or nested consumption.','Not directly referenced does not mean unused: subrecipes and modifiers can consume these ingredients.','Identical names or BOMs are review candidates, never authorization to merge/delete IDs.']};
}
if(require.main===module){const [dir,out]=process.argv.slice(2);if(!dir||!out)throw Error('Usage: node tools/audit-catalog.cjs EXPORT_DIR OUTPUT_JSON');const sources={};const read=action=>{const bytes=fs.readFileSync(path.join(dir,action+'.json'));sources[action]={sha256:crypto.createHash('sha256').update(bytes).digest('hex')};const j=JSON.parse(bytes);if(j.success!==true)throw Error('Invalid export '+action);return j.data;};const result=audit({products:read('get_products'),ingredients:read('get_ingredients'),recipes:read('get_recipes'),menu:read('get_menu_data')});fs.writeFileSync(out,JSON.stringify({generated_at:new Date().toISOString(),sources,...result},null,2));console.log(JSON.stringify(result.counts));}
module.exports={audit};
