async function get(url){const r=await fetch(url);return r.text()}
const html = await get('https://claudeapikey.dev/docs');
const ids = new Set([...html.matchAll(/claude-[a-z0-9][a-z0-9.\-]*/gi)].map(m=>m[0]));
console.log('docs 中出现:', [...ids].join(' '));
const pricing = await get('https://claudeapikey.dev/pricing');
const ids2 = new Set([...pricing.matchAll(/claude-[a-z0-9][a-z0-9.\-]*/gi)].map(m=>m[0]));
console.log('pricing 中出现:', [...ids2].join(' '));
