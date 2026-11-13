import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { emptyBoard, landing, winningLine, replay, bestMove, label } from './engine.js';

const $ = s => document.querySelector(s);
const host = $('#c4-viewport');
let board = emptyBoard(), moves = [], turn = 1, winner = null, busy = false, hinting = false;
let selected = -1, dropping = null, revision = 0;
let renderer, scene, camera, controls, pieces, preview, halo;
const pickers = [], tops = [], stones = new Map();
const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
const center = col => [(col % 4 - 1.5) * 1.32, (Math.floor(col / 4) - 1.5) * 1.32];
const height = i => .48 + (i >> 4) * .46;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let ringGeometry, darkMaterial, lightMaterial, ghostMaterial;

function status(text) { $('#c4-status').textContent = text; }
function update() {
  for (const side of [1, 2]) $('#player-' + side).classList.toggle('active', !winner && side === turn);
  $('#c4-count').innerHTML = String(moves.length).padStart(2, '0') + ' <span>/ 64</span>';
  host.dataset.moves = moves.length;
  host.dataset.turn = turn;
  host.dataset.over = String(!!winner || moves.length === 64);
  $('#c4-undo').disabled = busy || hinting || !moves.length;
  $('#c4-hint').disabled = busy || hinting || !!winner || moves.length === 64;
  if (winner) status((board[winner[0]] === 1 ? '黑方' : '白方') + '四子连线，赢了这局。');
  else if (moves.length === 64) status('棋盘满了，这局平手。');
  else if (busy) status((turn === 1 ? '黑方' : '白方') + '落子中…');
  else status((turn === 1 ? '黑方' : '白方') + '回合，点立柱落子。');
  select(selected);
}
function select(col) {
  selected = col;
  if (!preview) return;
  const i = landing(board, col), playable = i >= 0 && !busy && !winner && !hinting;
  preview.visible = playable;
  halo.visible = col >= 0 && !winner;
  $('#c4-position').textContent = col < 0 ? '' : `${label(col)} · ${i < 0 ? '已满' : `第 ${(i >> 4) + 1} 层`}`;
  if (col >= 0) {
    const [x, z] = center(col);
    preview.position.set(x, i >= 0 ? height(i) : 0, z);
    halo.position.set(x, 2.48, z);
    preview.material.color.set(turn === 1 ? 0x50534a : 0xfffdf1);
    halo.material.color.set(i < 0 ? 0xc96d51 : 0xb18c43);
  }
  requestRender();
}
function makeStone(i, side) {
  const mesh = new THREE.Mesh(ringGeometry, side === 1 ? darkMaterial : lightMaterial);
  const [x,z] = center(i % 16);
  mesh.position.set(x, height(i), z); mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.col = i % 16; pieces.add(mesh); stones.set(i, mesh);
  return mesh;
}
async function drop(col) {
  if (busy || winner || hinting) return;
  const i = landing(board, col);
  if (i < 0) { select(col); status('这根立柱放满了，换一根吧。'); return; }
  busy = true; board[i] = turn; moves.push(col); revision++;
  const mesh = makeStone(i, turn);
  update(); preview.visible = false;
  if (!reduced()) {
    const from = 3.2, to = height(i), started = performance.now();
    mesh.position.y = from;
    await new Promise(resolve => { dropping = { mesh, from, to, started, resolve }; requestRender(); });
  }
  winner = winningLine(board, i);
  if (winner) {
    const winMat = new THREE.MeshStandardMaterial({ color: 0xb98a39, roughness: .34, metalness: .55 });
    for (const at of winner) stones.get(at).material = winMat;
    host.dataset.winner = String(turn);
  }
  turn = 3 - turn; busy = false; update(); requestRender();
}
function rebuild() {
  stones.clear(); pieces.clear();
  board.forEach((side,i) => { if (side) makeStone(i,side); });
  delete host.dataset.winner; winner = winningLine(board); update(); requestRender();
}
$('#c4-undo').addEventListener('click', () => {
  if (busy || hinting || !moves.length) return;
  moves.pop(); board = replay(moves); turn = moves.length % 2 + 1; winner = null; revision++; rebuild();
});
$('#c4-new').addEventListener('click', () => {
  if (dropping) { const d = dropping; dropping = null; d.resolve(); }
  // The drop continuation completes before resetting so it cannot restore an old winner.
  queueMicrotask(() => { board = emptyBoard(); moves = []; turn = 1; winner = null; busy = false; hinting = false; revision++; selected = -1; rebuild(); });
});
$('#c4-hint').addEventListener('click', () => {
  if (busy || hinting || winner) return;
  const current = revision; hinting = true; update(); status('看看哪一根更合适…');
  setTimeout(() => {
    if (revision !== current) return;
    const col = bestMove(board, turn, 1); hinting = false; update(); select(col);
    if (col >= 0) status(`可以试试 ${label(col)}。金色圆环是建议落点，点它落子。`);
  }, 30);
});
$('#c4-fs').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#c4-stage').requestFullscreen(); } catch { status('当前浏览器不支持全屏，可以直接在这里玩。'); }
});

function woodTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const c = canvas.getContext('2d'); c.fillStyle = '#bc925e'; c.fillRect(0,0,512,512);
  for (let n=0;n<280;n++) {
    const y=n*2, wave=2+Math.sin(n*2.17)*2;
    c.beginPath(); c.moveTo(0,y); c.bezierCurveTo(150,y+wave,320,y-wave*2,512,y+wave);
    c.strokeStyle=`rgba(84,48,19,${.025+(Math.sin(n*6.3)+1)*.025})`; c.lineWidth=.5+(n%4)*.25; c.stroke();
  }
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function roundBox(width, depth, radius, thickness) {
  const s = new THREE.Shape(), x=-width/2, y=-depth/2;
  s.moveTo(x+radius,y); s.lineTo(x+width-radius,y); s.quadraticCurveTo(x+width,y,x+width,y+radius);
  s.lineTo(x+width,y+depth-radius); s.quadraticCurveTo(x+width,y+depth,x+width-radius,y+depth);
  s.lineTo(x+radius,y+depth); s.quadraticCurveTo(x,y+depth,x,y+depth-radius);
  s.lineTo(x,y+radius); s.quadraticCurveTo(x,y,x+radius,y);
  const g=new THREE.ExtrudeGeometry(s,{depth:thickness,bevelEnabled:true,bevelSize:.065,bevelThickness:.05,bevelSegments:3,steps:1,curveSegments:12});
  g.rotateX(-Math.PI/2); return g;
}
function addLabels() {
  for(let col=0;col<16;col++) {
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
    const c=canvas.getContext('2d');c.fillStyle='#775b37';c.font='500 30px Georgia';c.textAlign='center';c.fillText(label(col),64,41);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const m=new THREE.Mesh(new THREE.PlaneGeometry(.44,.22),new THREE.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
    const [x,z]=center(col); m.rotation.x=-Math.PI/2;m.position.set(x,.297,z+.51);scene.add(m);
  }
}
let frame = 0;
function requestRender() { if (!frame && renderer) frame=requestAnimationFrame(render); }
function render(time) {
  frame=0; controls.update();
  if(dropping) {
    const d=dropping,t=Math.min(1,(time-d.started)/580),impact=.78;
    if(t<impact)d.mesh.position.y=d.from+(d.to-d.from)*(t/impact)**2;
    else d.mesh.position.y=d.to+Math.sin((t-impact)/(1-impact)*Math.PI)*.09;
    if(t>=1){d.mesh.position.y=d.to;dropping=null;d.resolve();}
    else requestRender();
  }
  renderer.render(scene,camera);
}
function setView(view) {
  controls.target.set(0,.7,0);
  camera.position.set(...(view==='top'?[0,11,.01]:[7.2,7.4,9.3])); controls.update();
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('on',b.dataset.view===view);b.setAttribute('aria-pressed',String(b.dataset.view===view));});
  requestRender();
}
function hit(event) {
  const r=renderer.domElement.getBoundingClientRect();
  pointer.set((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1);
  ray.setFromCamera(pointer,camera);
  return ray.intersectObjects([...pickers,...stones.values()],false)[0]?.object.userData.col ?? -1;
}
function init() {
  scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(34,1,.1,80);
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setClearColor(0x000000,0);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  renderer.domElement.setAttribute('aria-hidden','true');host.prepend(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', e=>{e.preventDefault();status('三维画面暂时中断，请刷新页面恢复。');});
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.09;controls.enablePan=false;
  controls.minDistance=7;controls.maxDistance=17;controls.minPolarAngle=.01;controls.maxPolarAngle=Math.PI*.46;
  controls.addEventListener('change',requestRender);
  scene.add(new THREE.HemisphereLight(0xfff9e8,0x83735a,2.5));
  const sun=new THREE.DirectionalLight(0xfff7e9,3.3);sun.position.set(-3,9,5);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-5;sun.shadow.camera.right=5;sun.shadow.camera.top=5;sun.shadow.camera.bottom=-5;sun.shadow.normalBias=.025;sun.shadow.bias=-.00015;sun.shadow.radius=4;scene.add(sun);
  const fill=new THREE.DirectionalLight(0xf7f4ed,1.3);fill.position.set(5,3,-4);scene.add(fill);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.ShadowMaterial({color:0x736047,opacity:.16}));floor.rotation.x=-Math.PI/2;floor.position.y=-.09;floor.receiveShadow=true;scene.add(floor);
  const wood=new THREE.MeshStandardMaterial({map:woodTexture(),color:0xe7c798,roughness:.62,metalness:0});
  const base=new THREE.Mesh(roundBox(5.65,5.65,.32,.23),wood);base.position.y=.02;base.castShadow=true;base.receiveShadow=true;scene.add(base);
  const brass=new THREE.MeshStandardMaterial({color:0xc5ac7a,metalness:.72,roughness:.38});
  const socketMat=new THREE.MeshStandardMaterial({color:0x9f7a44,roughness:.65,metalness:.2});
  const rodGeo=new THREE.CylinderGeometry(.046,.054,2.13,16);
  const capGeo=new THREE.SphereGeometry(.05,16,12);
  const transparent=new THREE.MeshBasicMaterial({visible:false});
  for(let col=0;col<16;col++) {
    const [x,z]=center(col);
    const rod=new THREE.Mesh(rodGeo,brass);rod.position.set(x,1.355,z);rod.castShadow=true;scene.add(rod);
    const cap=new THREE.Mesh(capGeo,brass);cap.position.set(x,2.42,z);scene.add(cap);
    const foot=new THREE.Mesh(new THREE.CylinderGeometry(.13,.14,.035,24),socketMat);foot.position.set(x,.3,z);scene.add(foot);
    // Broad invisible hit areas make fingers practical without drawing a second input grid.
    const target=new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,2.55,16),transparent);target.position.set(x,1.48,z);target.userData.col=col;scene.add(target);pickers.push(target);
    const tile=new THREE.Mesh(new THREE.BoxGeometry(1.18,.025,1.18),transparent);tile.position.set(x,.32,z);tile.userData.col=col;scene.add(tile);pickers.push(tile);
    const top=new THREE.Mesh(new THREE.TorusGeometry(.16,.012,6,32),new THREE.MeshStandardMaterial({color:0xb59b6c,roughness:.55,transparent:true,opacity:.55}));top.rotation.x=Math.PI/2;top.position.set(x,2.45,z);scene.add(top);tops.push(top);
  }
  addLabels();
  const shape=new THREE.Shape();shape.absarc(0,0,.48,0,Math.PI*2,false);
  const hole=new THREE.Path();hole.absarc(0,0,.09,0,Math.PI*2,true);shape.holes.push(hole);
  ringGeometry=new THREE.ExtrudeGeometry(shape,{depth:.28,bevelEnabled:true,bevelSegments:4,bevelSize:.065,bevelThickness:.065,steps:1,curveSegments:40});
  ringGeometry.translate(0,0,-.14);ringGeometry.rotateX(-Math.PI/2);
  darkMaterial=new THREE.MeshStandardMaterial({color:0x30352f,roughness:.24,metalness:.07});
  lightMaterial=new THREE.MeshStandardMaterial({color:0xfff6df,roughness:.3,metalness:.03});
  ghostMaterial=new THREE.MeshStandardMaterial({color:0x50534a,transparent:true,opacity:.32,roughness:.4,depthWrite:false});
  pieces=new THREE.Group();scene.add(pieces);
  preview=new THREE.Mesh(ringGeometry,ghostMaterial);preview.visible=false;scene.add(preview);
  halo=new THREE.Mesh(new THREE.TorusGeometry(.38,.025,8,48),new THREE.MeshBasicMaterial({color:0xb18c43,transparent:true,opacity:.85,depthTest:false}));halo.rotation.x=Math.PI/2;halo.visible=false;halo.renderOrder=4;scene.add(halo);
  setView('angle');
  const resize=()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();requestRender();};
  new ResizeObserver(resize).observe(host);resize();
  let down=null;
  renderer.domElement.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY,id:e.pointerId};});
  renderer.domElement.addEventListener('pointermove',e=>{
    if(down){if(Math.hypot(e.clientX-down.x,e.clientY-down.y)>7)down.dragged=true;return;}
    select(hit(e));renderer.domElement.style.cursor=selected>=0?'pointer':'grab';
  });
  renderer.domElement.addEventListener('pointerup',e=>{
    if(down && !down.dragged && down.id===e.pointerId){const col=hit(e);select(col);if(col>=0)drop(col);}
    down=null;
  });
  renderer.domElement.addEventListener('pointercancel',()=>{down=null;});
  renderer.domElement.addEventListener('pointerleave',()=>{if(!down)select(-1);});
  host.addEventListener('keydown',e=>{
    if(e.target!==host)return;
    const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-4,ArrowDown:4}[e.key];
    if(delta!=null){e.preventDefault();select(((selected<0?5:selected)+delta+16)%16);}
    else if(e.key==='Enter'||e.key===' '){e.preventDefault();if(selected<0)select(5);else drop(selected);}
  });
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  $('#c4-reset').addEventListener('click',()=>setView('angle'));
  $('#c4-loading').hidden=true;update();
}
try { init(); } catch(err) {
  console.error('[三维四子棋]',err);
  $('#c4-loading').innerHTML='三维棋盘没有加载成功。<br>请确认浏览器支持 WebGL。<button type="button">重新加载</button>';
  $('#c4-loading button').addEventListener('click',()=>location.reload());
  for(const id of ['#c4-hint','#c4-new'])$(id).disabled=true;
}
