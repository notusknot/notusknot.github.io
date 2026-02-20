let audioCtx = null;
let node = null;

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");

const ratiosEl = document.getElementById("ratios");
const applyBtn = document.getElementById("applyBtn");

const tSlider = document.getElementById("tSlider");
const tLabel = document.getElementById("tLabel");

const rootHzEl = document.getElementById("rootHz");

const canvas = document.getElementById("cycleCanvas");
const ctx2d = canvas.getContext("2d");


function drawCycle(ratios, T) {
  const w = canvas.width;
  const h = canvas.height;

  ctx2d.clearRect(0, 0, w, h);

  const colors = ["#e63946", "#457b9d", "#2a9d8f", "#f4a261", "#9b5de5", "#06d6a0"];

  ratios.forEach((r, index) => {
    const y = 30 + index * 25;
    ctx2d.fillStyle = colors[index % colors.length];
    ctx2d.fillRect(0, y - 2, w, 4);

    const hits = Math.floor(r);
    for (let k = 0; k < hits; k++) {
      const x = (k / r) * w;
      ctx2d.fillRect(x, y - 10, 2, 20);
    }
  });
}

function computeTBounds(ratios, rootHz) {
  const rRoot = Math.min(...ratios);
  const Tmin = rRoot / Math.max(1, rootHz); // seconds
  const Tmax = 2.0;                         // keep your rhythm range (tweak as you like)
  return { Tmin, Tmax };
}

function parseRatios(str) {
  // Accept "2:3:4:5:6" or "2 3 4 5 6" or "2,3,4"
  const parts = str.split(/[: ,]+/).map(s => s.trim()).filter(Boolean);
  const nums = parts.map(p => Number(p)).filter(n => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return [2, 3, 4, 5, 6];
  return nums;
}

function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
function gcdAll(arr) {
  return arr.reduce((g, x) => gcd(g, Math.round(x)), 0);
}

function updateTLabel(T) {
  tLabel.textContent = `T = ${T.toFixed(6)} s`;
  
}

// Map slider [0..1] to T in seconds (log scale).
// Big T = rhythm, small T = pitch.
// You can tweak these bounds freely.
function sliderToT(u, Tmin, Tmax) {
  // u in [0..1], map to T in [Tmax..Tmin] on a log scale
  const logMin = Math.log(Tmin);
  const logMax = Math.log(Tmax);
  const logT = logMax + (logMin - logMax) * u; // u=0 -> Tmax, u=1 -> Tmin
  return Math.exp(logT);
}

function currentMode() {
  const v = document.querySelector('input[name="mode"]:checked').value;
  return v; // "click" or "sine"
}

function sendParams() {
  if (!node) return;

  let ratios = parseRatios(ratiosEl.value);

  // Reduce by integer gcd for nicer display/sanity (keeps same pitch classes)
  const ints = ratios.map(x => Math.round(x));
  const g = gcdAll(ints) || 1;
  ratios = ints.map(x => x / g);

  //const T = sliderToT(Number(tSlider.value));
  //const rootHz = Number(rootHzEl.value) || 110;


  const rRoot = Math.min(...ratios);

  //let T = sliderToT(Number(tSlider.value));
  const rootHz = Number(rootHzEl.value) || 440;
  const { Tmin, Tmax } = computeTBounds(ratios, rootHz);

  const T = sliderToT(Number(tSlider.value), Tmin, Tmax);

  updateTLabel(T);

  drawCycle(ratios, T);

  node.port.postMessage({
    type: "params",
    ratios,
    T,
    mode: currentMode(),
    rootHz,
  });
}


async function startAudio() {
  if (audioCtx) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  // IMPORTANT for Firefox:
  // Resume immediately inside the click handler.
  await audioCtx.resume();

  // Load worklet AFTER resume
  await audioCtx.audioWorklet.addModule("worklet.js");

  node = new AudioWorkletNode(audioCtx, "ratio-polyrhythm");

  node.onprocessorerror = (e) => {
    console.error("Processor crashed:", e);
  };

  node.connect(audioCtx.destination);

  node.port.onmessage = (e) => {
    if (e.data?.type === "debug") {
      console.log("[worklet]", e.data.msg);
    }
  };

  sendParams();

  statusEl.textContent = `running @ ${audioCtx.sampleRate} Hz`;
  startBtn.disabled = true;
  stopBtn.disabled = false;
}


async function stopAudio() {
  if (!audioCtx) return;
  try {
    node.disconnect();
    node = null;
    await audioCtx.close();
  } finally {
    audioCtx = null;
    statusEl.textContent = "stopped";
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

startBtn.addEventListener("click", startAudio);
stopBtn.addEventListener("click", stopAudio);

applyBtn.addEventListener("click", sendParams);

let pending = false;
tSlider.addEventListener("input", () => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    sendParams();
  });
});

rootHzEl.addEventListener("input", sendParams);
document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener("change", sendParams));

// Initialize label
updateTLabel(sliderToT(Number(tSlider.value)));
