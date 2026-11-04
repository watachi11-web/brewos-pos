// Build a static copy in a NEW output directory; never rewrite production files.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const PAGES=['dashboard.html','pos.html','kitchen.html','crm.html','finance.html','daily_close.html','monthly_control.html','orders.html','inventory.html','login.html'];
function build(root,out,endpoint){
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(endpoint))throw Error('Invalid staging endpoint');
 const production=fs.readFileSync(path.join(root,'api.js'),'utf8').match(/const API_BASE = '([^']+)'/)[1];
 if(endpoint===production)throw Error('Production endpoint forbidden');
 if(fs.existsSync(out))throw Error('Output must not exist');fs.mkdirSync(out,{recursive:true});
 const files=fs.readdirSync(root).filter(f=>/\.(js|css|png|jpg|svg|webp)$/.test(f)).concat(PAGES);
 const banner='<div id="stage-banner" style="background:#842029;color:white;padding:8px;text-align:center;font:700 14px sans-serif;flex-shrink:0;z-index:99999">STAGING / ทดสอบเท่านั้น — ข้อมูลสมมติ ไม่ใช่ยอดร้านจริง</div>';
 for(const f of files){let data=fs.readFileSync(path.join(root,f));if(/\.(html|js|css)$/.test(f)){
  let s=data.toString().split(production).join(endpoint).replace(/brewos_/g,'brewos_staging_').replace(/brewos-/g,'brewos-staging-');
  if(f.endsWith('.html')){s=s.replace(/<head>/i,'<head><script src="staging-guard.js"></script>');s=s.replace(/<body([^>]*)>/i,'<body$1>'+banner);s=s.replace(/href="([\w-]+\.html)"/g,(m,target)=>PAGES.includes(target)?m:'href="dashboard.html"');s=s.replace(/<title>/i,'<title>[STAGING] ');}
  if(s.includes(production))throw Error('Production URL retained');
  const urls=[...s.matchAll(/https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec/g)].map(m=>m[0]);if(urls.some(u=>u!==endpoint))throw Error('Unexpected backend URL in '+f);
  data=s;
 }fs.writeFileSync(path.join(out,f),data);}
 const guard=`'use strict';\nconst STAGING_ENDPOINT=${JSON.stringify(endpoint)};\nconst originalFetch=window.fetch.bind(window);let stageProof=null;\nasync function assertStaging(){if(!stageProof)stageProof=originalFetch(STAGING_ENDPOINT+'?action=ping',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.success||j.data.environment!=='staging'||j.data.fixture!=='synthetic-v1'||j.data.recipe_release!=='86b1276152041fdeddc83aa6f5f7ee9d968f47f0871f6e129c18c44cd3f0ae76')throw Error('STAGING identity check failed');}).catch(e=>{stageProof=null;throw e;});return stageProof;}\nwindow.fetch=async function(input,options){const u=new URL(typeof input==='string'?input:input.url||String(input),location.href),allowed=new URL(STAGING_ENDPOINT);if(u.origin!==allowed.origin||u.pathname!==allowed.pathname)throw Error('STAGING blocked unexpected request');await assertStaging();return originalFetch(input,options);};\n`;
 new vm.Script(guard);fs.writeFileSync(path.join(out,'staging-guard.js'),guard);fs.writeFileSync(path.join(out,'index.html'),'<meta http-equiv="refresh" content="0;url=dashboard.html">');
 return files.length;
}
if(require.main===module){const [out,url]=process.argv.slice(2);console.log(build(path.resolve(__dirname,'../..'),path.resolve(out),url));}module.exports={build,PAGES};
