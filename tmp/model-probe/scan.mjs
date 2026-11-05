const KEY='sk-e2f362e443f4fe518cab50226734ce7e1aa0b251c4c5ca8f5a2fe2e0cead014a';
const names=['claude-sonnet-5','claude-opus-5','claude-opus-4-1-20250805','claude-sonnet-4-5-20250929','claude-sonnet-4-20250514','claude-3-7-sonnet-20250219','claude-3-5-sonnet-20241022','claude-haiku-4-5-20251001','claude-opus-4-20250514'];
for(const m of names){
  try{
    const r=await fetch('https://claudeapikey.dev/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+KEY},body:JSON.stringify({model:m,max_tokens:4,messages:[{role:'user',content:'hi'}]})});
    const b=(await r.text()).replace(/\s+/g,' ').slice(0,160);
    console.log(String(r.status).padEnd(4), m.padEnd(30), b);
  }catch(e){console.log('ERR ', m, String(e))}
}
