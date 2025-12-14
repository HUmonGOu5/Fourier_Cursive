let font;
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const pathEl = document.getElementById("path");

async function loadFont() {
  return new Promise((resolve, reject) => {
    opentype.load("YOUR_FONT.ttf", (err, f) => err ? reject(err) : resolve(f));
  });
}

function samplePath(N) {
  const L = pathEl.getTotalLength();
  const pts = [];
  for (let i = 0; i < N; i++) {
    const p = pathEl.getPointAtLength((i/(N-1)) * L);
    pts.push({x: p.x, y: p.y});
  }
  // center
  const cx = pts.reduce((s,p)=>s+p.x,0)/N;
  const cy = pts.reduce((s,p)=>s+p.y,0)/N;
  for (const p of pts) { p.x -= cx; p.y -= cy; }
  return pts;
}

function dftComplex(z) {
  const N = z.length;
  const out = [];
  for (let k = 0; k < N; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const phi = -2*Math.PI*k*n/N;
      const c = Math.cos(phi), s = Math.sin(phi);
      re += z[n].re*c - z[n].im*s;
      im += z[n].re*s + z[n].im*c;
    }
    // frequency mapping to negative..positive
    const freq = (k <= N/2) ? k : k - N;
    const cre = re / N, cim = im / N;
    out.push({
      freq,
      re: cre,
      im: cim,
      amp: Math.hypot(cre, cim),
      phase: Math.atan2(cim, cre)
    });
  }
  out.sort((a,b)=>b.amp-a.amp);
  return out;
}

function renderTextToPath(text, fontSize=200) {
  const p = font.getPath(text, 0, 0, fontSize);
  pathEl.setAttribute("d", p.toPathData(2));
}

let coeffs = [];
let t = 0;
let trail = [];

function step() {
  const M = +document.getElementById("terms").value;
  ctx.clearRect(0,0,canvas.width,canvas.height);

  let x = canvas.width/2, y = canvas.height/2;

  // draw epicycles
  for (let i = 0; i < Math.min(M, coeffs.length); i++) {
    const c = coeffs[i];
    const r = c.amp;
    const ang = 2*Math.PI*c.freq*t + c.phase;

    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2*Math.PI);
    ctx.stroke();

    x += r*Math.cos(ang);
    y += r*Math.sin(ang);
  }

  trail.push({x,y});
  ctx.beginPath();
  for (let i=0;i<trail.length;i++){
    const p = trail[i];
    if(i===0) ctx.moveTo(p.x,p.y);
    else ctx.lineTo(p.x,p.y);
  }
  ctx.stroke();

  t += 1/512;
  if (t >= 1) { t = 0; trail = []; }
  requestAnimationFrame(step);
}

document.getElementById("render").onclick = () => {
  const text = document.getElementById("text").value;
  renderTextToPath(text, 220);

  const pts = samplePath(1024);
  const z = pts.map(p => ({re: p.x, im: p.y}));

  coeffs = dftComplex(z);
  t = 0; trail = [];
};

(async () => {
  // You need to put a font file in your repo and load it here.
  font = await loadFont();
  requestAnimationFrame(step);
})();
