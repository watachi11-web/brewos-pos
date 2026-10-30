// Text and attributes only; never use HTML escaping inside JavaScript handlers.
(function(root){
  const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function customer(value){const c=value||{};return {...c,customer_id:String(c.customer_id||''),full_name:String(c.full_name||c.name||''),phone:String(c.phone||''),brand_id:String(c.brand_id||'SHARED')};}
  const api={html,customer};if(typeof module==='object'&&module.exports)module.exports=api;root.BrewUI=api;
})(typeof globalThis==='object'?globalThis:this);
