// TRASH CAM V2 (iOS/Safari-safe rebuild)
// - uses dynamic viewport sizing + VisualViewport resize hook
// - stable canvas pipeline (no vh traps)
// - CCD-ish corruption effects (blocks, bitcrush, feedback, noise, false color, data bars)
// - date stamp (date only) low-res

const video = document.getElementById('vid');
const canvas = document.getElementById('out');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const ui = {
  flip: document.getElementById('flip'),
  bend: document.getElementById('bend'),
  snap: document.getElementById('snap'),
  tip: document.getElementById('tip'),

  t_blocks: document.getElementById('t_blocks'),
  t_bit: document.getElementById('t_bit'),
  t_feedback: document.getElementById('t_feedback'),
  t_noise: document.getElementById('t_noise'),
  t_false: document.getElementById('t_false'),
  t_bars: document.getElementById('t_bars'),
  t_date: document.getElementById('t_date'),

  s_grit: document.getElementById('s_grit'),
  s_corrupt: document.getElementById('s_corrupt'),
  s_chroma: document.getElementById('s_chroma'),
  s_palette: document.getElementById('s_palette'),
  s_res: document.getElementById('s_res'),
};

let facingMode = "environment";
let stream = null;

// internal buffers
const low = document.createElement('canvas');
const lctx = low.getContext('2d', { willReadFrequently: true });

const fb = document.createElement('canvas'); // feedback buffer
const fbctx = fb.getContext('2d', { willReadFrequently: true });

let bendBurst = 0;

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function rand(n=1){ return Math.random()*n; }

function setTip(msg){ ui.tip.innerHTML = msg; }

function dateStamp(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}/${mm}/${dd}`;
}

async function startCamera(){
  if (stream) stream.getTracks().forEach(t => t.stop());

  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });

  video.srcObject = stream;
  await new Promise(res => video.onloadedmetadata = res);

  resizeAll();
  requestAnimationFrame(loop);
}

function resizeAll(){
  // Output canvas matches visual viewport for iOS toolbar changes
  const vw = Math.floor((window.visualViewport?.width || window.innerWidth));
  const vh = Math.floor((window.visualViewport?.height || window.innerHeight));

  // Use devicePixelRatio but cap for performance
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  canvas.width = Math.floor(vw * dpr);
  canvas.height = Math.floor(vh * dpr);

  // feedback buffer same size
  fb.width = canvas.width;
  fb.height = canvas.height;

  // low-res buffer from slider
  const res = parseInt(ui.s_res.value, 10);
  const aspect = canvas.height / canvas.width || (16/9);
  low.width = res;
  low.height = Math.max(120, Math.round(res * aspect));
}

function drawCoverTo(targetCtx, W, H){
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;

  const srcAspect = vw / vh;
  const dstAspect = W / H;

  let sx=0, sy=0, sW=vw, sH=vh;

  if (srcAspect > dstAspect){
    sH = vh;
    sW = vh * dstAspect;
    sx = (vw - sW) / 2;
  } else {
    sW = vw;
    sH = vw / dstAspect;
    sy = (vh - sH) / 2;
  }

  targetCtx.drawImage(video, sx, sy, sW, sH, 0, 0, W, H);
}

function bitcrush(img, amt){
  const d = img.data;
  const levels = Math.floor(2 + (1-amt) * 14); // stronger amt => fewer levels
  const step = 255 / levels;

  for (let i=0; i<d.length; i+=4){
    d[i]   = Math.round(d[i]/step)*step;
    d[i+1] = Math.round(d[i+1]/step)*step;
    d[i+2] = Math.round(d[i+2]/step)*step;
  }
}

function rgbSplit(img, amt){
  const w = img.width, h = img.height;
  const d = img.data;
  const out = new Uint8ClampedArray(d.length);

  const maxShift = Math.floor(amt * 10);
  const rx = (Math.random()*2-1) * maxShift;
  const gx = (Math.random()*2-1) * maxShift;
  const bx = (Math.random()*2-1) * maxShift;

  function sample(x,y,chan){
    x = clamp(x,0,w-1); y = clamp(y,0,h-1);
    return d[(y*w + x)*4 + chan];
  }

  for (let y=0; y<h; y++){
    for (let x=0; x<w; x++){
      const i = (y*w + x)*4;
      out[i]   = sample(x+rx, y, 0);
      out[i+1] = sample(x+gx, y, 1);
      out[i+2] = sample(x+bx, y, 2);
      out[i+3] = 255;
    }
  }

  img.data.set(out);
}

function noise(img, amt){
  const d = img.data;
  const n = amt * 28;
  for (let i=0; i<d.length; i+=4){
    const r = (Math.random()*2-1) * n;
    d[i]   = clamp(d[i] + r, 0, 255);
    d[i+1] = clamp(d[i+1] + r, 0, 255);
    d[i+2] = clamp(d[i+2] + r, 0, 255);
  }
}

function falseColor(img, amt){
  const d = img.data;
  const k = amt; // 0..1
  for (let i=0; i<d.length; i+=4){
    const lum = (0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]) / 255;
    // map lum into a neon-ish palette
    const r = clamp(255 * (1 - lum) * (0.6 + 0.4*k) + 40*k, 0, 255);
    const g = clamp(255 * (lum)       * (0.8 + 0.2*k) + 30*k, 0, 255);
    const b = clamp(255 * (0.35 + 0.65*Math.sin(lum*3.1415)) * (0.7 + 0.3*k), 0, 255);

    d[i]   = clamp(d[i]*(1-k) + r*k, 0, 255);
    d[i+1] = clamp(d[i+1]*(1-k) + g*k, 0, 255);
    d[i+2] = clamp(d[i+2]*(1-k) + b*k, 0, 255);
  }
}

function blockGlitch(img, amt){
  const w = img.width, h = img.height;
  const d = img.data;

  const blocks = Math.floor(8 + amt*55 + bendBurst*50);
  for (let b=0; b<blocks; b++){
    const bw = Math.floor(8 + rand(amt*60 + 20));
    const bh = Math.floor(4 + rand(amt*40 + 14));
    const x0 = Math.floor(rand(w - bw));
    const y0 = Math.floor(rand(h - bh));

    // shift source block from another area
    const sx = Math.floor(clamp(x0 + (rand(1)-0.5) * (amt*80 + 30), 0, w-bw));
    const sy = Math.floor(clamp(y0 + (rand(1)-0.5) * (amt*60 + 30), 0, h-bh));

    for (let y=0; y<bh; y++){
      for (let x=0; x<bw; x++){
        const di = ((y0+y)*w + (x0+x))*4;
        const si = ((sy+y)*w + (sx+x))*4;
        d[di]   = d[si];
        d[di+1] = d[si+1];
        d[di+2] = d[si+2];
      }
    }
  }
}

function dataBars(ctxOut, W, H, amt){
  const bars = Math.floor(2 + amt*7);
  const bw = Math.floor(10 + amt*26);

  ctxOut.save();
  ctxOut.globalAlpha = 0.55;
  for (let i=0; i<bars; i++){
    const x = Math.floor(rand(W));
    const h2 = Math.floor(H*(0.35 + rand(0.65)));
    ctxOut.fillStyle = `rgba(${Math.floor(rand(255))},${Math.floor(rand(255))},${Math.floor(rand(255))},1)`;
    ctxOut.fillRect(x, Math.floor(rand(H-h2)), bw, h2);
  }
  ctxOut.restore();
}

function feedbackPass(ctxOut, W, H, amt){
  // smear previous frame slightly
  fbctx.save();
  fbctx.globalAlpha = 0.92 - amt*0.22;
  fbctx.drawImage(canvas, 0, 0);
  fbctx.restore();

  ctxOut.save();
  ctxOut.globalAlpha = 0.20 + amt*0.38;
  ctxOut.globalCompositeOperation = 'screen';
  const dx = (rand(1)-0.5) * (amt*10 + bendBurst*14);
  const dy = (rand(1)-0.5) * (amt*8  + bendBurst*10);
  ctxOut.drawImage(fb, dx, dy);
  ctxOut.restore();
}

function drawDate(ctxOut, W, H){
  // low-res stamp look
  const pad = Math.floor(W * 0.03);
  ctxOut.save();
  ctxOut.imageSmoothingEnabled = false;
  ctxOut.font = `900 ${Math.floor(W*0.038)}px ui-monospace, Menlo, Monaco, Consolas, monospace`;
  ctxOut.fillStyle = "rgba(255,220,80,0.95)";
  ctxOut.shadowColor = "rgba(0,0,0,0.65)";
  ctxOut.shadowBlur = 8;
  ctxOut.fillText(dateStamp(), pad, H - pad);
  ctxOut.restore();
}

function applyPreset(name){
  const set = (id, v) => document.getElementById(id).checked = v;
  const setS = (id, v) => document.getElementById(id).value = v;

  if (name === "mall"){
    set("t_blocks", true); set("t_bit", true); set("t_feedback", true);
    set("t_noise", true); set("t_false", false); set("t_bars", false); set("t_date", true);
    setS("s_grit", 72); setS("s_corrupt", 52); setS("s_chroma", 35); setS("s_palette", 25); setS("s_res", 280);
  }
  if (name === "buffer"){
    set("t_blocks", true); set("t_bit", true); set("t_feedback", true);
    set("t_noise", true); set("t_false", true); set("t_bars", true); set("t_date", true);
    setS("s_grit", 80); setS("s_corrupt", 70); setS("s_chroma", 62); setS("s_palette", 65); setS("s_res", 220);
  }
  if (name === "neon"){
    set("t_blocks", true); set("t_bit", true); set("t_feedback", true);
    set("t_noise", true); set("t_false", true); set("t_bars", false); set("t_date", true);
    setS("s_grit", 86); setS("s_corrupt", 62); setS("s_chroma", 70); setS("s_palette", 90); setS("s_res", 200);
  }
  if (name === "digi"){
    set("t_blocks", false); set("t_bit", false); set("t_feedback", false);
    set("t_noise", true); set("t_false", false); set("t_bars", false); set("t_date", true);
    setS("s_grit", 30); setS("s_corrupt", 18); setS("s_chroma", 20); setS("s_palette", 25); setS("s_res", 420);
  }

  resizeAll();
}

function snap(){
  const a = document.createElement('a');
  a.download = `trashcam_v2_${new Date().toISOString().replace(/[:.]/g,'-')}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

function loop(){
  // resize if RES changed a lot (cheap check)
  // keeping this stable helps iOS
  const res = parseInt(ui.s_res.value, 10);
  if (low.width !== res) resizeAll();

  const W = canvas.width;
  const H = canvas.height;

  // draw camera into low-res buffer (cover)
  lctx.clearRect(0,0,low.width, low.height);
  drawCoverTo(lctx, low.width, low.height);

  let img = lctx.getImageData(0,0,low.width, low.height);

  const grit = parseInt(ui.s_grit.value,10) / 100;
  const corrupt = parseInt(ui.s_corrupt.value,10) / 100;
  const chroma = parseInt(ui.s_chroma.value,10) / 100;
  const palette = parseInt(ui.s_palette.value,10) / 100;

  // bend burst decays
  bendBurst = Math.max(0, bendBurst - 0.04);

  if (ui.t_blocks.checked) blockGlitch(img, corrupt);
  if (ui.t_bit.checked) bitcrush(img, grit);
  if (chroma > 0.01) rgbSplit(img, chroma + bendBurst*0.6);
  if (ui.t_noise.checked) noise(img, grit);
  if (ui.t_false.checked) falseColor(img, palette);

  lctx.putImageData(img, 0, 0);

  // upscale to output canvas
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(low, 0, 0, W, H);
  ctx.restore();

  // feedback layer (after main draw)
  if (ui.t_feedback.checked) feedbackPass(ctx, W, H, corrupt);

  // data bars overlay
  if (ui.t_bars.checked) dataBars(ctx, W, H, corrupt + bendBurst*0.6);

  // date stamp
  if (ui.t_date.checked) drawDate(ctx, W, H);

  requestAnimationFrame(loop);
}

/* Events */
ui.flip.addEventListener('click', async () => {
  facingMode = (facingMode === "environment") ? "user" : "environment";
  await startCamera();
});

ui.bend.addEventListener('click', () => {
  bendBurst = 1.0;
});

ui.snap.addEventListener('click', snap);

// presets
document.querySelectorAll('[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});

// iOS dynamic viewport handling
if (window.visualViewport){
  window.visualViewport.addEventListener('resize', () => resizeAll());
  window.visualViewport.addEventListener('scroll', () => resizeAll());
}
window.addEventListener('orientationchange', () => resizeAll());
window.addEventListener('resize', () => resizeAll());

/* Start */
(async () => {
  try{
    setTip("Open in Safari + HTTPS. Hit <b>BEND</b> for a burst.");
    await startCamera();
  }catch(err){
    document.body.innerHTML = `
      <div style="padding:20px;font-family:system-ui;color:#fff">
        <h2>Camera blocked</h2>
        <p>Open in <b>Safari</b>, allow Camera permissions, and make sure you’re on <b>HTTPS</b>.</p>
        <pre style="white-space:pre-wrap;color:#bbb">${String(err)}</pre>
      </div>
    `;
    console.error(err);
  }
})();
