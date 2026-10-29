// The hosted source has embedded images and private configuration. Do not publish it.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const BASELINE_SHA='1e55bb2059c7710f5dc4db72097c91c72e9721e2c7f56e5350257d09f0bbd93a';
function once(s,a,b){if(s.split(a).length!==2)throw Error('Mobile patch anchor not unique: '+a);return s.replace(a,b);}
function build(source){
 if(crypto.createHash('sha256').update(source).digest('hex')!==BASELINE_SHA)throw Error('Mobile baseline changed; inspect first');
 const start=source.indexOf('function sendOrderToBackend('),end=source.indexOf('// CONFIRM ORDER',start),banner=source.lastIndexOf('// ═',end);
 if(start<0||end<0||banner<start)throw Error('Missing mobile send block');
 const client=fs.readFileSync(path.join(__dirname,'../sale-client.js'),'utf8'),adapter=fs.readFileSync(path.join(__dirname,'mobile-sale-client.js'),'utf8');
 source=source.slice(0,start)+client+'\n'+adapter+'\n'+source.slice(banner);
 source=once(source,'async function confirmOrder() {',`async function confirmOrder() {
  if(mobileSaleBusy)return;
  try{if(mobileSalePending()){refreshMobileSalePending();showToast('กรุณาตรวจผลบิลค้างก่อน');return;}}
  catch(e){refreshMobileSalePending();showToast(e.message);return;}`);
 source=once(source,"  btnPay.textContent = 'กำลังบันทึก...';","  mobileSaleBusy=true;\n  btnPay.textContent = 'กำลังบันทึก...';");
 source=once(source,"    btnPay.disabled = Object.keys(cart).length === 0;","    mobileSaleBusy=false;\n    refreshMobileSalePending();");
 source=once(source,"  document.getElementById('btnPay').disabled = totalQty === 0;","  refreshMobileSalePending();");
 source=once(source,"    document.getElementById('rcptOverlay').classList.add('open');","    clearCart();\n    document.getElementById('rcptOverlay').classList.add('open');");
 source=once(source,"    showToast('❌ บันทึกออเดอร์ไม่สำเร็จ: ' + (err.message || 'กรุณาลองใหม่'));","    let unresolved=true;try{unresolved=!!mobileSalePending();}catch(_e){}\n    showToast(unresolved?'ยังยืนยันผลบิลไม่ได้ กรุณาตรวจผลบิลค้าง ห้ามรับเงินซ้ำ':'ยังไม่ได้บันทึก: '+err.message);");
 source=once(source,"    const catMap = {","    rcpId='RCP-'+dateStr.replace(/-/g,'')+'-'+crypto.randomUUID();\n    const catMap = {");
 source=once(source,'</body>',`<div id="salePending" hidden role="status" style="position:fixed;bottom:90px;left:12px;right:12px;z-index:9999;background:#fff3df;color:#1c3526;border:1px solid #d5aa66;padding:14px;border-radius:12px">
<div id="salePendingText"></div><button id="saleRecover" type="button" onclick="recoverMobileSale()" style="padding:10px;margin-top:8px">ตรวจผลบิลค้าง</button></div>
<div id="saleVerified" role="status" style="padding:8px;text-align:center"></div></body>`);
 for(const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);
 return source;
}
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output||path.resolve(input)===path.resolve(output))throw Error('Distinct paths required');fs.writeFileSync(output,build(fs.readFileSync(input,'utf8')),{flag:'wx'});}
module.exports={build,BASELINE_SHA};
