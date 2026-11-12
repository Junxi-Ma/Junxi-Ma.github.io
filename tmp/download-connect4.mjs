import https from 'node:https';
import fs from 'node:fs/promises';
const root = new URL('../tools/connect4/vendor/', import.meta.url);
for (const [url, name] of [
 ['https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js','three.module.js'],
 ['https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js','OrbitControls.js'],
 ['https://cdn.jsdelivr.net/npm/three@0.160.0/LICENSE','LICENSE']
]) {
 const content = await new Promise((resolve,reject) => https.get(url,res => { if(res.statusCode!==200){res.resume();reject(new Error(String(res.statusCode)));return;} const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(Buffer.concat(chunks))); }).on('error',reject));
 await fs.writeFile(new URL(name,root),content); console.log(name,content.length);
}
