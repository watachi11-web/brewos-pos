const BREWOS_API='https://script.google.com/macros/s/AKfycbxw8XBigvESVUCugH7CNUnTWel_s_oMdRrJ4Bbyeb43wF5gwrUaOXrzKIUADUsPR52Pdg/exec';
async function brewGet(action,params={}){const u=new URL(BREWOS_API);u.searchParams.set('action',action);Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));const r=await fetch(u);return r.json()}
async function brewPost(payload){const r=await fetch(BREWOS_API,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});return r.json()}
const BrewOSDailyClose={preview:(date)=>brewGet('get_daily_close_preview',{date}),list:(limit=31)=>brewGet('get_daily_closes',{limit}),close:(data)=>brewPost({action:'close_day',...data})};
