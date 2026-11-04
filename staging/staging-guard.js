'use strict';
const STAGING_ENDPOINT="https://script.google.com/macros/s/AKfycbxc_Cj6fp0Ro8naiKx7Of0oH7PbGkPKfbNs1MN1BRKFR8PBajzDxQUsNwye5PdNQsTPSw/exec";
const originalFetch=window.fetch.bind(window);let stageProof=null;
async function assertStaging(){if(!stageProof)stageProof=originalFetch(STAGING_ENDPOINT+'?action=ping',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(!j.success||j.data.environment!=='staging'||j.data.fixture!=='synthetic-v1'||j.data.recipe_release!=='86b1276152041fdeddc83aa6f5f7ee9d968f47f0871f6e129c18c44cd3f0ae76')throw Error('STAGING identity check failed');}).catch(e=>{stageProof=null;throw e;});return stageProof;}
window.fetch=async function(input,options){const u=new URL(typeof input==='string'?input:input.url||String(input),location.href),allowed=new URL(STAGING_ENDPOINT);if(u.origin!==allowed.origin||u.pathname!==allowed.pathname)throw Error('STAGING blocked unexpected request');await assertStaging();return originalFetch(input,options);};
