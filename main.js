/* Allura text -> SVG path -> arc-length points -> DFT -> epicycle animation */

const TAU = Math.PI * 2;

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const pathEl = document.getElementById("p");

const statusEl = document.getElementById("status");

const txtEl = document.getElementById("txt");
const fsEl = document.getElementById("fs");
const nEl  = document.getElementById("N");
const mEl  = document.getElementById("M");

document.getElementById("fsVal").textContent = fsEl.value;
document.getElementById("NVal").textContent = nEl.value;
document.getElementById("MVal").textContent = mEl.value;

fsEl.oninput = e => document.getElementById("fsVal").textContent = e.target.value;
nEl.oninput  = e => document.getElementById("NVal").textContent = e.target.value;
mEl.oninput  = e => document.getElementById("MVal").textContent = e.target.value;

function fitCanvas() {
  const dpr = devicePixelRatio || 1;
  canvas.width  = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
  // Draw in CSS pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", () => { fitCanvas(); resetAnim(); });

/* -------- complex helpers -------- */
function complex(re, im) { return { re, im }; }
function cAdd(a, b) { return { re: a.re + b.re, im: a.im + b.im }; }
function cMul(a, b) { return { re: a.re*b.re - a.im*b.im, im: a.re*b.im + a.im*b.re }; }
function cExp(theta) { return { re: Math.cos(theta), im: Math.sin(theta) }; }
function cAbs(a) { return Math.hypot(a.re, a.im); }
function cPhase(a) { return Math.atan2(a.im, a.re); }

/* -------- font -> svg path data -------- */
let font = null;

function loadFont(url) {
  return new Promise((resolve, reject) => {
    opentype.load(url, (err, f) => err ? reject(err) : resolve(f));
  });
}

function textToPathData(font, text, fontSize) {
  // y is the baseline; we center later from sampled points, so 0 is fine.
  const x = 0, y = 0;
  const path = font.getPath(text, x, y, fontSize);
  return path.toPathData(2); // decimals: 2 is a good balance
}

/* -------- svg path -> points (uniform arc length) -------- */
function sampleSvgPath(pathEl, N) {
  const L = pathEl.getTotalLength();
  const pts = [];
  for (let i = 0; i < N; i++) {
    const s = (i / (N - 1)) * L;
    const p = pathEl.getPointAtLength(s);
    pts.push({ x: p.x, y: p.y });
  }
  return pts;
}

function centerAndNormalize(pts) {
  const N = pts.length;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= N; cy /= N;

  let maxAbs = 0;
  for (const p of pts) {
    p.x -= cx; p.y -= cy;
    maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y));
  }
  const s = maxAbs > 0 ? 1 / maxAbs : 1;
  for (const p of pts) { p.x *= s; p.y *= s; }
  return pts;
}

function pointsToComplex(pts) {
  // Canvas uses y-down; math uses y-up. We flip later while drawing.
  return pts.map(p => complex(p.x, p.y));
}

/* -------- DFT of complex samples --------
   C[k] = (1/N) * sum z[n] e^{-j2pi k n / N}
*/
function dft(zs) {
  const N = zs.length;
  const coeffs = [];

  for (let k = 0; k < N; k++) {
    let sum = complex(0, 0);
    for (let n = 0; n < N; n++) {
      const theta = -TAU * k * n / N;
      sum = cAdd(sum, cMul(zs[n], cExp(theta)));
    }
    sum.re /= N; sum.im /= N;

    const freq = (k <= N/2) ? k : k - N; // signed frequency
    coeffs.push({
      freq,
      re: sum.re,
      im: sum.im,
      amp: cAbs(sum),
      phase: cPhase(sum),
    });
  }

  // Sort by amplitude so "best" terms draw first
  coeffs.sort((a, b) => b.amp - a.amp);
  return coeffs;
}

/* -------- animation / drawing -------- */
let basePoints = [];     // sampled shape points (complex)
let coeffs = [];         // Fourier terms (sorted by amplitude)
let t = 0;               // in [0,1)
let trail = [];
let paused = false;

function resetAnim() {
  t = 0;
  trail = [];
}

function drawFrame() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.clearRect(0, 0, w, h);

  // Scale to canvas
  const scale = 0.42 * Math.min(w, h);
  let x = w / 2;
  let y = h / 2;

  const M = +mEl.value;

  // Epicycles: start at center, add vectors
  for (let i = 0; i < Math.min(M, coeffs.length); i++) {
    const c = coeffs[i];
    const r = c.amp * scale;
    const ang = TAU * c.freq * t + c.phase;

    // circle
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();

    // vector tip (note: y axis inverted for screen)
    const nx = x + r * Math.cos(ang);
    const ny = y - r * Math.sin(ang);

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(nx, ny);
    ctx.stroke();

    x = nx; y = ny;
  }

  // trail
  trail.push({ x, y });

  ctx.beginPath();
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i];
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  if (!paused && basePoints.length > 0) {
    // step so one full trace roughly per N steps
    t += 1 / basePoints.length;
    if (t >= 1) resetAnim();
  }

  requestAnimationFrame(drawFrame);
}

/* -------- pipeline: text -> coeffs -------- */
async function computeFromText() {
  if (!font) return;

  const text = txtEl.value.trim() || " ";
  const fontSize = +fsEl.value;
  const N = +nEl.value;

  const d = textToPathData(font, text, fontSize);
  pathEl.setAttribute("d", d);

  // If text is empty/space, total length can be 0.
  const L = pathEl.getTotalLength();
  if (!isFinite(L) || L <= 0.1) {
    statusEl.textContent = "Nothing to draw (path length ~0). Try different text.";
    basePoints = [];
    coeffs = [];
    resetAnim();
    return;
  }

  let pts = sampleSvgPath(pathEl, N);
  pts = centerAndNormalize(pts);

  basePoints = pointsToComplex(pts);
  coeffs = dft(basePoints);

  resetAnim();
  statusEl.textContent = `Ready. Path length=${L.toFixed(1)} | N=${N} | terms sorted by amplitude`;
}

document.getElementById("render").onclick = computeFromText;

document.getElementById("toggle").onclick = () => {
  paused = !paused;
  document.getElementById("toggle").textContent = paused ? "Play" : "Pause";
};

(async () => {
  fitCanvas();
  try {
    statusEl.textContent = "Loading Allura-Regular.ttf…";
    font = await loadFont("Allura-Regular.ttf");
    statusEl.textContent = "Font loaded. Click Render.";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Failed to load font. Check Allura-Regular.ttf path.";
  }
  requestAnimationFrame(drawFrame);
})();
