// Trash Cam V2 — Photo-only CCD corruption web app (PWA-style)

const video = document.getElementById('v');
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

const ui = {
  flip: document.getElementById('flip'),
  snap: document.getElementById('snap'),
  bend: document.getElementById('bend'),
  random: document.getElementById('random'),
  tip: document.getElementById('tip'),

  e_rgb: document.getElementById('e_rgb'),
  e_tear: document.getElementById('e_tear'),
  e_blocks: document.getElementById('e_blocks'),
  e_bit: document.getElementById('e_bit'),
  e_feedback: document.getElementById('e_feedback'),
  e_noise: document.getElementById('e_noise'),
  e_false: document.getElementById('e_false'),
  e_bars: document.getElementById('e_bars'),
  e_date: document.getElementById('e_date'),

  grit: document.getElementById('grit'),
  corrupt: document.getElementById('corrupt'),
  chrom: document.getElementById('chrom'),
  palette: document.getElementById('palette'),
  res: document.getElementById('res'),

  presetBtns: [...document.querySelectorAll('[data-preset]')]
};

let facingMode = "environment";
let stream = null;

const state = {
  grit: 0.62,
  corrupt: 0.62,
  chrom: 0.60,
  palette: 0.75,
  baseW: 360,

  bendUntil: 0,
  prevFrame: null
};

function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function irand(n){ return Math.floor(Math.random() * n); }

function hash2(x,y,t){
  let n = x*374761393 + y*668265263 + t*69069;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function readUI(){
  state.grit = parseInt(ui.grit.value,10) / 100;
  state.corrupt = parseInt(ui.corrupt.value,10) / 100;
  state.chrom = parseInt(ui.chrom.value,10) / 100;
  state.palette = parseInt(ui.palette.value,10) / 100;
  state.baseW = parseInt(ui.res.value,10);
}

function setTip(msg){
  ui.tip.innerHTML = msg;
}

function bendSpike(ms=900){
  state.bendUntil = performance.now() + ms;
  setTip("BEND engaged: instability spike.");
  setTimeout(() => setTip('Open in <b>Safari</b> + HTTPS. Hit <b>BEND</b> for a burst.'), ms + 200);
}

async function startCamera(){
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode,
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });

  video.srcObject = stream;
  await new Promise(res => video.onloadedmetadata = res);

  // canvas size based on baseW and camera aspect
  const aspect = video.videoHeight / video.videoWidth || (9/16);
  canvas.width = state.baseW;
  canvas.height = Math.max(200, Math.round(state.baseW * aspect));

  state.prevFrame = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  requestAnimationFrame(loop);
}

/* ---------------- Effects ---------------- */

function rgbSplit(img, w, h, amt){
  const d = img.data;
  const out = new Uint8ClampedArray(d.length);
  for (let y=0; y<h; y++){
    for (let x=0; x<w; x++){
      const i = (y*w + x)*4;
      const rx = Math.max(0, Math.min(w-1, x + amt));
      const bx = Math.max(0, Math.min(w-1, x - amt));
      const iR = (y*w + rx)*4;
      const iB = (y*w + bx)*4;
      out[i]   = d[iR];
      out[i+1] = d[i+1];
      out[i+2] = d[iB+2];
      out[i+3] = 255;
    }
  }
  d.set(out);
}

function lineTear(img, w, h, strength, t){
  const d = img.data;
  const out = new Uint8ClampedArray(d.length);

  const tearChance = 0.06 + strength * 0.22;
  for (let y=0; y<h; y++){
    let off = 0;
    const n = hash2(y, 13, t);
    if (n < tearChance){
      off = Math.floor((hash2(y, 99, t) - 0.5) * (6 + strength*34));
    }
    for (let x=0; x<w; x++){
      const sx = Math.max(0, Math.min(w-1, x + off));
      const si = (y*w + sx)*4;
      const di = (y*w + x)*4;
      out[di]   = d[si];
      out[di+1] = d[si+1];
      out[di+2] = d[si+2];
      out[di+3] = 255;
    }
  }
  d.set(out);
}

function blockCorrupt(img, w, h, amount, t){
  const d = img.data;
  const blocks = Math.floor(6 + amount * 30);

  for (let b=0; b<blocks; b++){
    const bw = 10 + irand(44);
    const bh = 10 + irand(36);
    const x0 = irand(Math.max(1, w - bw));
    const y0 = irand(Math.max(1, h - bh));

    const dx = Math.floor((hash2(b, 7, t) - 0.5) * (10 + amount*90));
    const dy = Math.floor((hash2(b, 9, t) - 0.5) * (6 + amount*50));

    for (let y=0; y<bh; y++){
      const sy = Math.max(0, Math.min(h-1, y0 + y));
      const ty = Math.max(0, Math.min(h-1, y0 + y + dy));
      for (let x=0; x<bw; x++){
        const sx = Math.max(0, Math.min(w-1, x0 + x));
        const tx = Math.max(0, Math.min(w-1, x0 + x + dx));
        const si = (sy*w + sx) * 4;
        const ti = (ty*w + tx) * 4;

        // copy with channel scramble
        const r = d[si], g = d[si+1], bch = d[si+2];
        d[ti]   = g;
        d[ti+1] = bch;
        d[ti+2] = r;
      }
    }
  }
}

function bitcrush(img, grit){
  const d = img.data;
  const levels = Math.max(2, Math.floor(32 - grit * 28));
  const step = 255 / (levels - 1);

  for (let i=0; i<d.length; i+=4){
    d[i]   = Math.round(d[i]   / step) * step;
    d[i+1] = Math.round(d[i+1] / step) * step;
    d[i+2] = Math.round(d[i+2] / step) * step;
  }
}

function addNoise(img, w, h, grit, t){
  const d = img.data;
  const amp = 6 + grit * 34;
  for (let y=0; y<h; y++){
    for (let x=0; x<w; x++){
      const i = (y*w + x)*4;
      const n = (hash2(x, y, t) - 0.5) * amp;
      d[i]   = Math.max(0, Math.min(255, d[i] + n));
      d[i+1] = Math.max(0, Math.min(255, d[i+1] + n));
      d[i+2] = Math.max(0, Math.min(255, d[i+2] + n));
    }
  }
}

function feedbackBlend(img, prev, amount){
  const d = img.data;
  const a = clamp01(amount);
  for (let i=0; i<d.length; i+=4){
    d[i]   = d[i]   * (1-a) + prev[i]   * a;
    d[i+1] = d[i+1] * (1-a) + prev[i+1] * a;
    d[i+2] = d[i+2] * (1-a) + prev[i+2] * a;
    d[i+3] = 255;
  }
}

function updatePrev(img){
  state.prevFrame.set(img.data);
}

/* --- False color / palette smash --- */

const PALETTES = [
  // green/magenta/cyan/yellow
  [
    [0,0,0], [18,24,18], [60,120,60], [30,255,80],
    [255,0,160], [255,70,210], [120,220,255], [255,255,120]
  ],
  // cyan/pink/yellow
  [
    [0,0,0], [0,40,60], [0,180,220], [255,0,180],
    [255,120,0], [255,255,0], [210,255,255], [255,255,255]
  ],
  // cheap digi bands
  [
    [0,0,0], [30,20,10], [80,60,25], [160,120,40],
    [40,220,70], [220,40,210], [60,255,255], [255,255,255]
  ]
];

function luma(r,g,b){ return (0.2126*r + 0.7152*g + 0.0722*b); }

function channelMash(img, w, h, amount, t){
  const d = img.data;
  const perms = [
    [0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]
  ];
  for (let y=0; y<h; y++){
    const pick = (hash2(y, 77, t) < (0.10 + amount*0.55)) ? perms[irand(perms.length)] : perms[0];
    for (let x=0; x<w; x++){
      const i = (y*w + x)*4;
      const r=d[i], g=d[i+1], b=d[i+2];
      const arr=[r,g,b];
      d[i]   = arr[pick[0]];
      d[i+1] = arr[pick[1]];
      d[i+2] = arr[pick[2]];
    }
  }
}

function falseColorMap(img, w, h, strength, t){
  const d = img.data;
  const pal = PALETTES[(Math.floor(t/40) % PALETTES.length)];
  const bands = Math.max(3, Math.floor(8 - strength*5)); // 8..3

  for (let i=0; i<d.length; i+=4){
    let y = luma(d[i], d[i+1], d[i+2]) / 255;
    const wob = (hash2(i, 17, t) - 0.5) * (0.08 + strength*0.22);
    y = Math.max(0, Math.min(1, y + wob));

    const idx = Math.max(0, Math.min(pal.length-1, Math.floor(y * (bands-1)) * Math.floor((pal.length-1)/(bands-1))));
    const p = pal[idx];

    const mix = 0.35 + strength*0.65;
    d[i]   = d[i]   * (1-mix) + p[0]*mix;
    d[i+1] = d[i+1] * (1-mix) + p[1]*mix;
    d[i+2] = d[i+2] * (1-mix) + p[2]*mix;
  }
}

function dataBars(img, w, h, amount, t){
  const d = img.data;
  const barChance = 0.08 + amount*0.35;
  const bars = (hash2(9,9,t) < barChance) ? (1 + irand(3)) : 0;

  for (let b=0; b<bars; b++){
    const bw = 8 + irand(22);
    const x0 = irand(Math.max(1, w - bw));
    const colA = (hash2(b, 3, t) > 0.5) ? [40,255,80] : [255,0,200];
    const colB = (hash2(b, 5, t) > 0.5) ? [255,255,0] : [0,255,255];

    for (let y=0; y<h; y++){
      const on = (Math.floor((y + t*2) / (2 + irand(3))) % 2) === 0;
      const c = on ? colA : colB;
      for (let x=0; x<bw; x++){
        const i = (y*w + (x0 + x))*4;
        d[i] = c[0]; d[i+1] = c[1]; d[i+2] = c[2];
      }
    }
  }
}

function neonBlockSmash(img, w, h, amount, t){
  const d = img.data;
  const blocks = Math.floor(2 + amount*18);
  const pal = PALETTES[(Math.floor(t/60) % PALETTES.length)];
  for (let b=0; b<blocks; b++){
    if (hash2(b, 11, t) > (0.45 + amount*0.5)) continue;
    const bw = 10 + irand(60);
    const bh = 10 + irand(55);
    const x0 = irand(Math.max(1, w - bw));
    const y0 = irand(Math.max(1, h - bh));
    const p = pal[irand(pal.length)];

    for (let y=0; y<bh; y++){
      for (let x=0; x<bw; x++){
        const i = ((y0+y)*w + (x0+x))*4;
        const n = (hash2(x0+x, y0+y, t) - 0.5) * (10 + amount*40);
        d[i]   = Math.max(0, Math.min(255, p[0] + n));
        d[i+1] = Math.max(0, Math.min(255, p[1] + n));
        d[i+2] = Math.max(0, Math.min(255, p[2] + n));
      }
    }
  }
}

/* --- Low-res date stamp (YYYY/MM/DD) --- */
const stamp = { c: document.createElement('canvas'), ctx: null };
stamp.ctx = stamp.c.getContext('2d', { willReadFrequently: true });

function drawDateStampLowRes(mainCtx, w, h){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const text = `${yyyy}/${mm}/${dd}`;

  const sw = 220, sh = 44;
  stamp.c.width = sw; stamp.c.height = sh;
  const s = stamp.ctx;
  s.clearRect(0,0,sw,sh);

  s.font = `900 26px ui-monospace, Menlo, Monaco, Consolas, monospace`;
  s.textBaseline = 'top';

  s.fillStyle = 'rgba(0,0,0,0.70)';
  s.fillText(text, 3, 3);

  s.fillStyle = 'rgb(255, 230, 80)';
  s.fillText(text, 1, 1);

  // speckle
  const img = s.getImageData(0,0,sw,sh);
  const data = img.data;
  for (let i=0; i<data.length; i+=4){
    const bright = data[i] + data[i+1] + data[i+2];
    if (bright > 500 && Math.random() < 0.10){
      const j = (Math.random() < 0.5) ? -20 : 20;
      data[i]   = Math.max(0, Math.min(255, data[i] + j));
      data[i+1] = Math.max(0, Math.min(255, data[i+1] + j));
      data[i+2] = Math.max(0, Math.min(255, data[i+2] + j));
    }
  }
  s.putImageData(img,0,0);

  const pad = Math.max(10, Math.floor(w * 0.03));
  const scale = Math.max(2, Math.floor(w / 240));
  const dw = sw * scale * 0.42;
  const dh = sh * scale * 0.42;

  mainCtx.save();
  mainCtx.imageSmoothingEnabled = false;
  mainCtx.drawImage(stamp.c, pad, h - pad - dh, dw, dh);
  mainCtx.restore();
}

/* ---------------- Presets & Random ---------------- */

function applyPreset(name){
  if (name === "mall"){
    ui.e_rgb.checked = true; ui.e_tear.checked = true; ui.e_blocks.checked = true;
    ui.e_bit.checked = true; ui.e_feedback.checked = false; ui.e_noise.checked = true;
    ui.e_false.checked = true; ui.e_bars.checked = true; ui.e_date.checked = true;
    ui.grit.value="55"; ui.corrupt.value="52"; ui.chrom.value="62"; ui.palette.value="68";
  }
  if (name === "broken"){
    ui.e_rgb.checked = true; ui.e_tear.checked = true; ui.e_blocks.checked = true;
    ui.e_bit.checked = true; ui.e_feedback.checked = true; ui.e_noise.checked = true;
    ui.e_false.checked = true; ui.e_bars.checked = true; ui.e_date.checked = true;
    ui.grit.value="72"; ui.corrupt.value="82"; ui.chrom.value="74"; ui.palette.value="78";
    bendSpike(1200);
  }
  if (name === "neon"){
    ui.e_rgb.checked = true; ui.e_tear.checked = false; ui.e_blocks.checked = true;
    ui.e_bit.checked = true; ui.e_feedback.checked = true; ui.e_noise.checked = true;
    ui.e_false.checked = true; ui.e_bars.checked = true; ui.e_date.checked = true;
    ui.grit.value="65"; ui.corrupt.value="70"; ui.chrom.value="55"; ui.palette.value="92";
  }
  if (name === "cheap"){
    ui.e_rgb.checked = true; ui.e_tear.checked = false; ui.e_blocks.checked = true;
    ui.e_bit.checked = true; ui.e_feedback.checked = true; ui.e_noise.checked = true;
    ui.e_false.checked = false; ui.e_bars.checked = false; ui.e_date.checked = true;
    ui.grit.value="62"; ui.corrupt.value="58"; ui.chrom.value="40"; ui.palette.value="55";
  }
  readUI();
}

function randomize(){
  ui.e_rgb.checked = Math.random() > 0.08;
  ui.e_tear.checked = Math.random() > 0.28;
  ui.e_blocks.checked = Math.random() > 0.12;
  ui.e_bit.checked = Math.random() > 0.10;
  ui.e_feedback.checked = Math.random() > 0.38;
  ui.e_noise.checked = Math.random() > 0.08;
  ui.e_false.checked = Math.random() > 0.15;
  ui.e_bars.checked = Math.random() > 0.25;
  ui.e_date.checked = Math.random() > 0.30;

  ui.grit.value = String(35 + irand(55));
  ui.corrupt.value = String(25 + irand(70));
  ui.chrom.value = String(20 + irand(70));
  ui.palette.value = String(25 + irand(70));

  if (Math.random() > 0.55) bendSpike(700 + irand(900));
  readUI();
}

/* ---------------- Loop + Snap ---------------- */

function loop(now){
  readUI();

  // if resolution slider changed, rebuild canvas (keeps aspect)
  if (canvas.width !== state.baseW) {
    const aspect = video.videoHeight / video.videoWidth || (9/16);
    canvas.width = state.baseW;
    canvas.height = Math.max(200, Math.round(state.baseW * aspect));
    state.prevFrame = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  }

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const bending = now < state.bendUntil;
  const grit = clamp01(state.grit + (bending ? 0.25 : 0));
  const corrupt = clamp01(state.corrupt + (bending ? 0.35 : 0));
  const chrom = clamp01(state.chrom + (bending ? 0.35 : 0));
  const palAmt = clamp01(state.palette + (bending ? 0.25 : 0));

  const t = Math.floor(now / 33);

  // CCD pipeline
  if (ui.e_feedback.checked){
    feedbackBlend(img, state.prevFrame, (0.10 + grit*0.35) * (bending ? 1.25 : 1.0));
  }

  if (ui.e_rgb.checked){
    const amt = Math.floor(1 + chrom * 10 + (bending ? 6 : 0));
    rgbSplit(img, canvas.width, canvas.height, amt);
  }

  if (ui.e_tear.checked){
    lineTear(img, canvas.width, canvas.height, corrupt, t);
  }

  if (ui.e_blocks.checked){
    if (Math.random() < (0.35 + corrupt*0.5) * (bending ? 1.15 : 1.0)) {
      blockCorrupt(img, canvas.width, canvas.height, corrupt, t);
    }
    // neon block overlays for “palette smash” vibe
    if (ui.e_false.checked && Math.random() < (0.22 + corrupt*0.55) * (bending ? 1.2 : 1.0)){
      neonBlockSmash(img, canvas.width, canvas.height, palAmt, t);
    }
  }

  if (ui.e_false.checked){
    channelMash(img, canvas.width, canvas.height, palAmt, t);
    falseColorMap(img, canvas.width, canvas.height, palAmt, t);
  }

  if (ui.e_bars.checked){
    dataBars(img, canvas.width, canvas.height, palAmt, t);
  }

  if (ui.e_bit.checked){
    bitcrush(img, grit);
  }

  if (ui.e_noise.checked){
    addNoise(img, canvas.width, canvas.height, grit, t);
  }

  ctx.putImageData(img, 0, 0);
  updatePrev(img);

  if (ui.e_date.checked){
    drawDateStampLowRes(ctx, canvas.width, canvas.height);
  }

  requestAnimationFrame(loop);
}

function snap(){
  // iOS: may open the image instead of direct download; still works to save/share.
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  a.download = `trashcam_v2_${stamp}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}

/* ---------------- Events ---------------- */

ui.snap.addEventListener('click', snap);

ui.flip.addEventListener('click', async () => {
  facingMode = (facingMode === "environment") ? "user" : "environment";
  await startCamera();
});

ui.bend.addEventListener('click', () => bendSpike(900));
ui.random.addEventListener('click', randomize);

ui.presetBtns.forEach(btn => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});

/* ---------------- Start ---------------- */

(async () => {
  try{
    await startCamera();
  }catch(err){
    document.body.innerHTML = `
      <div style="padding:20px;font-family:system-ui;color:#fff">
        <h2>Camera blocked</h2>
        <p>Open this page in <b>Safari</b>, allow Camera permissions, and make sure you’re on <b>HTTPS</b>.</p>
        <pre style="white-space:pre-wrap;color:#bbb">${String(err)}</pre>
      </div>
    `;
    console.error(err);
  }
})();
