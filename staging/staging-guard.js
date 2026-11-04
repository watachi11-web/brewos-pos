'use strict';
const STAGING_ENDPOINT="https://script.google.com/macros/s/AKfycbxc_Cj6fp0Ro8naiKx7Of0oH7PbGkPKfbNs1MN1BRKFR8PBajzDxQUsNwye5PdNQsTPSw/exec";
const originalFetch=window.fetch.bind(window);let stageProof=null;
async function assertStaging(){if(!stageProof)stageProof=originalFetch(STAGING_ENDPOINT+'?action=ping',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.success||j.data.environment!=='staging'||j.data.fixture!=='synthetic-v1'||j.data.recipe_release!=='d58c9f86168f4c40c3b8cf412dabed43f93864e91524c8ff7f81b4b408ff099e')throw Error('STAGING identity check failed');}).catch(e=>{stageProof=null;throw e;});return stageProof;}
window.fetch=async function(input,options){const u=new URL(typeof input==='string'?input:input.url||String(input),location.href),allowed=new URL(STAGING_ENDPOINT);if(u.origin!==allowed.origin||u.pathname!==allowed.pathname)throw Error('STAGING blocked unexpected request');await assertStaging();return originalFetch(input,options);};
