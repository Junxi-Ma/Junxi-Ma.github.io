const KEY='sk-e2f362e443f4fe518cab50226734ce7e1aa0b251c4c5ca8f5a2fe2e0cead014a';
async function t(url,opts){try{const r=await fetch(url,opts);const b=await r.text();return {s:r.status,b:b.slice(0,2000)}}catch(e){return{e:String(e)}}}
for (const p of ['/','/docs','/pricing']) {
  const r = await t('https://claudeapikey.dev'+p);
  console.log('==',p,'==', r.s||r.e);
  console.log((r.b||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,700));
  console.log();
}
// 用 OpenAI 兼容端点再探一次，看错误码是否同样
const o = await t('https://claudeapikey.dev/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+KEY},body:JSON.stringify({model:'claude-sonnet-4-5-20250929',max_tokens:8,messages:[{role:'user',content:'hi'}]})});
console.log('== openai-compat ==',o.s||o.e, (o.b||'').slice(0,300));
