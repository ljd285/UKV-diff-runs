import h5wasm from "./vendor/h5wasm/hdf5_hl.js";
import { makeLaea } from "./laea.js";

const BASE = "https://met-office-atmospheric-model-data.s3-eu-west-2.amazonaws.com/uk-deterministic-2km";
const FILES = {
  t: "temperature_at_screen_level",
  tmax: "temperature_at_screen_level_max-PT01H",
  tmin: "temperature_at_screen_level_min-PT01H",
  td: "temperature_of_dew_point_at_screen_level",
};
const AVAILABLE_AFTER_H = 4.5; // el ciclo completo se termina de subir ~4 h 15 min después de su hora
const HOUR = 3600e3;

// Ciudades de referencia (solo punto, sin nombre).
const CITIES = [
  [-0.13, 51.51], [-1.90, 52.48], [-2.24, 53.48], [-1.55, 53.80], [-1.61, 54.98], [-3.19, 55.95],
  [-4.25, 55.86], [-2.10, 57.15], [-4.22, 57.48], [-5.93, 54.60], [-3.18, 51.48], [-2.59, 51.45],
  [-4.14, 50.37], [1.30, 52.63], [-1.40, 50.90], [-2.99, 53.41], [-1.47, 53.38], [-5.54, 50.12],
  [-1.15, 60.16], [-6.37, 58.21], [-3.00, 58.99], [-6.26, 53.35], [-3.53, 50.72], [-0.34, 53.74],
];

const $ = id => document.getElementById(id);
const pad = (n, w = 2) => String(n).padStart(w, "0");
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

// ---------- Colores (rampa continua por tramos) ----------
const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;
function lut(stops) {
  const out = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255 * (stops.length - 1), k = Math.min(Math.floor(t), stops.length - 2), f = t - k;
    const a = hex(stops[k]), b = hex(stops[k + 1]);
    for (let c = 0; c < 3; c++) out[i * 4 + c] = a[c] + (b[c] - a[c]) * f;
    out[i * 4 + 3] = 255;
  }
  return out;
}
const palettes = () => dark()
  ? {
      // gris neutro en el centro; los extremos se aclaran sobre fondo oscuro
      diff: lut(["#9ec5f4", "#2a78d6", "#383835", "#c0392b", "#ff9d8a"]),
      seq: lut(["#0d366b", "#2a78d6", "#b7d3f6"]),
    }
  : {
      diff: lut(["#184f95", "#6da7ec", "#f0efec", "#f08c7a", "#a8201a"]),
      seq: lut(["#dbe9fb", "#2a78d6", "#0d366b"]),
    };

// ---------- Datos ----------
await h5wasm.ready;
const { FS } = await h5wasm.ready;
const cache = new Map();
let fileSeq = 0;

function cycleName(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}00Z`;
}
function urlFor(cycleT, lead, key) {
  return `${BASE}/${cycleName(cycleT)}/${cycleName(cycleT + lead * HOUR)}-PT${pad(lead, 4)}H00M-${FILES[key]}.nc`;
}

async function loadField(cycleT, lead, key) {
  const url = urlFor(cycleT, lead, key);
  if (cache.has(url)) return cache.get(url);
  let res = await fetch(url);
  if (res.status === 404) { // un 404 puntual se reintenta una vez antes de darlo por no disponible
    await new Promise(r => setTimeout(r, 800));
    res = await fetch(url);
  }
  if (res.status === 404 || res.status === 403) {
    throw new Error(`No disponible: ${url.split("/").slice(-2).join("/")} (la pasada aún no está subida o ese alcance no existe).`);
  }
  if (!res.ok) throw new Error(`Error ${res.status} descargando ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const path = `/f${++fileSeq}.nc`;
  FS.writeFile(path, buf);
  const f = new h5wasm.File(path, "r");
  try {
    const name = f.keys().find(k => {
      const d = f.get(k);
      return d && d.shape && d.shape.length === 2 && d.shape[0] > 500 && !k.endsWith("_bnds");
    });
    const v = f.get(name);
    const [ny, nx] = v.shape;
    const xs = f.get("projection_x_coordinate").value, ys = f.get("projection_y_coordinate").value;
    const field = {
      data: Float32Array.from(v.value), nx, ny,
      x0: xs[0], dx: xs[1] - xs[0], y0: ys[0], dy: ys[1] - ys[0],
    };
    cache.set(url, field);
    return field;
  } finally {
    f.close();
    FS.unlink(path);
  }
}

// ---------- Estado / UI ----------
const state = { view: "diff", A: null, B: null, token: 0, geom: null };

function defaultCycle() {
  const now = Date.now();
  const day = Math.floor(now / 86400e3) * 86400e3;
  for (let d = 0; d <= 3; d++) for (const h of [15, 3]) {
    const t = day - d * 86400e3 + h * HOUR;
    if (t + AVAILABLE_AFTER_H * HOUR <= now) return t;
  }
}

function readControls() {
  const [y, m, d] = $("date").value.split("-").map(Number);
  const tA = Date.UTC(y, m - 1, d) + Number($("run").value) * HOUR;
  const lead = Number($("lead").value), off = Number($("offset").value);
  return { key: $("variable").value, tA, lead, tB: tA - off * HOUR, leadB: lead + off, off };
}
const fmt = t => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}Z`; };

function setStatus(msg, err = false) { const s = $("status"); s.textContent = msg; s.className = "info" + (err ? " err" : ""); }

async function update() {
  const c = readControls();
  $("leadLabel").textContent = `+${c.lead} h`;
  $("info").innerHTML = `Validez <b>${fmt(c.tA + c.lead * HOUR)}</b> · A: <b>${fmt(c.tA)} +${c.lead} h</b> · B: <b>${fmt(c.tB)} +${c.leadB} h</b>`;
  const token = ++state.token;
  if (c.leadB > 120) { setStatus("El alcance de la pasada B superaría 120 h; reduce el alcance.", true); return; }
  setStatus("Descargando…");
  try {
    const [A, B] = await Promise.all([loadField(c.tA, c.lead, c.key), loadField(c.tB, c.leadB, c.key)]);
    if (token !== state.token) return;
    state.A = A; state.B = B;
    setStatus("");
    render();
  } catch (e) {
    if (token !== state.token) return;
    state.A = state.B = null;
    clearCanvas();
    setStatus(e.message, true);
  }
}

// ---------- Dibujo ----------
const map = $("map"), over = $("over");
function clearCanvas() {
  for (const cv of [map, over]) cv.getContext("2d").clearRect(0, 0, cv.width, cv.height);
  $("stats").innerHTML = ""; $("legend").innerHTML = "";
}

const percentile = (arr, p) => { const s = Float32Array.from(arr).sort(); return s[Math.floor(p * (s.length - 1))]; };

let coast = null;
async function getCoast() { return coast ??= await (await fetch("coast.json")).json(); }
const laea = makeLaea();

function render() {
  const { A, B } = state;
  if (!A || !B) return;
  const { nx, ny } = A;
  for (const cv of [map, over]) { cv.width = nx; cv.height = ny; }
  const pal = palettes();
  const view = state.view;
  const n = nx * ny;
  const diff = new Float32Array(n);
  for (let i = 0; i < n; i++) diff[i] = A.data[i] - B.data[i];

  let vals, lo, hi, table;
  if (view === "diff") {
    const s = Number($("scale").value);
    vals = diff; lo = -s; hi = s; table = pal.diff;
  } else {
    // misma escala para A y B, para que sean comparables entre sí
    vals = (view === "a" ? A : B).data;
    const both = new Float32Array(2 * n); both.set(A.data); both.set(B.data, n);
    lo = percentile(both, 0.02) - 273.15; hi = percentile(both, 0.98) - 273.15; table = pal.seq;
    if (!(hi > lo)) hi = lo + 1;
  }
  const img = new ImageData(nx, ny);
  const px = img.data;
  for (let r = 0; r < ny; r++) {
    const j = ny - 1 - r; // la malla va de sur a norte
    for (let i = 0; i < nx; i++) {
      let v = vals[j * nx + i];
      const o = (r * nx + i) * 4;
      if (!Number.isFinite(v)) continue;
      if (view !== "diff") v -= 273.15;
      const t = Math.min(255, Math.max(0, Math.round((v - lo) / (hi - lo) * 255))) * 4;
      px[o] = table[t]; px[o + 1] = table[t + 1]; px[o + 2] = table[t + 2]; px[o + 3] = 255;
    }
  }
  map.getContext("2d").putImageData(img, 0, 0);
  state.geom = { A, B, diff };
  drawOverlay();
  drawLegend(view, lo, hi, table);
  drawStats(diff);
}

async function drawOverlay() {
  const { A } = state;
  if (!A) return;
  const ctx = over.getContext("2d");
  ctx.clearRect(0, 0, over.width, over.height);
  const toPx = (lon, lat) => {
    const [x, y] = laea(lon, lat);
    return [(x - A.x0) / A.dx + 0.5, A.ny - 1 - (y - A.y0) / A.dy + 0.5];
  };
  const ink = dark() ? "230,233,237" : "27,31,36", ring = dark() ? "#1a1a19" : "#ffffff";
  ctx.lineJoin = "round";
  ctx.strokeStyle = `rgba(${ink},0.55)`; ctx.lineWidth = 1.4;
  for (const line of await getCoast()) {
    ctx.beginPath();
    line.forEach(([lon, lat], k) => { const [x, y] = toPx(lon, lat); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
  for (const [lon, lat] of CITIES) {
    const [x, y] = toPx(lon, lat);
    ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 7); ctx.fillStyle = ring; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fillStyle = `rgb(${ink})`; ctx.fill();
  }
}

function drawLegend(view, lo, hi, table) {
  const lg = $("legend");
  lg.innerHTML = "";
  const unit = "°C";
  const left = document.createElement("span"), right = document.createElement("span");
  const bar = document.createElement("canvas"); bar.width = 256; bar.height = 1;
  const id = new ImageData(256, 1);
  id.data.set(table.subarray(0, 1024));
  bar.getContext("2d").putImageData(id, 0, 0);
  if (view === "diff") {
    left.textContent = `${lo} ${unit} · A más fría`; right.textContent = `A más cálida · +${hi} ${unit}`;
  } else {
    left.textContent = `${lo.toFixed(1)} ${unit}`; right.textContent = `${hi.toFixed(1)} ${unit}`;
  }
  lg.append(left, bar, right);
}

function drawStats(diff) {
  let n = 0, sum = 0, sq = 0, ab = 0, mx = -Infinity, mn = Infinity, g1 = 0;
  for (const d of diff) {
    if (!Number.isFinite(d)) continue;
    n++; sum += d; sq += d * d; ab += Math.abs(d);
    if (d > mx) mx = d; if (d < mn) mn = d; if (Math.abs(d) > 1) g1++;
  }
  const sg = v => (v > 0 ? "+" : "") + v.toFixed(2);
  const tiles = [
    ["Diferencia media", `${sg(sum / n)} °C`],
    ["Diferencia absoluta media", `${(ab / n).toFixed(2)} °C`],
    ["Error cuadrático medio", `${Math.sqrt(sq / n).toFixed(2)} °C`],
    ["Máx. A más cálida", `${sg(mx)} °C`],
    ["Máx. A más fría", `${sg(mn)} °C`],
    ["Celdas con |Δ| > 1 °C", `${(100 * g1 / n).toFixed(1)} %`],
  ];
  $("stats").innerHTML = tiles.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("");
}

// ---------- Tooltip ----------
const tip = $("tip");
over.addEventListener("pointermove", e => {
  const g = state.geom;
  if (!g) return;
  const r = over.getBoundingClientRect();
  const i = Math.floor((e.clientX - r.left) / r.width * g.A.nx), row = Math.floor((e.clientY - r.top) / r.height * g.A.ny);
  const j = g.A.ny - 1 - row;
  if (i < 0 || j < 0 || i >= g.A.nx || j >= g.A.ny) { tip.style.display = "none"; return; }
  const k = j * g.A.nx + i;
  const a = g.A.data[k] - 273.15, b = g.B.data[k] - 273.15, d = g.diff[k];
  tip.innerHTML = `Δ <b>${d > 0 ? "+" : ""}${d.toFixed(1)} °C</b><br>A <b>${a.toFixed(1)}</b> · B <b>${b.toFixed(1)}</b> °C`;
  tip.style.display = "block";
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 150) + "px";
  tip.style.top = e.clientY + 14 + "px";
});
over.addEventListener("pointerleave", () => { tip.style.display = "none"; });

// ---------- Eventos ----------
function init() {
  const t = defaultCycle(), d = new Date(t);
  $("date").value = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  $("run").value = pad(d.getUTCHours());
  for (const id of ["variable", "date", "run", "offset", "lead"]) $(id).addEventListener("input", update);
  $("scale").addEventListener("input", render);
  const nudge = k => { $("lead").value = Math.min(108, Math.max(0, Number($("lead").value) + k)); update(); };
  $("prev").onclick = () => nudge(-1);
  $("next").onclick = () => nudge(1);
  $("view").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    state.view = b.dataset.v;
    document.querySelectorAll("#view button").forEach(x => x.setAttribute("aria-pressed", x === b));
    $("scaleWrap").style.visibility = state.view === "diff" ? "visible" : "hidden";
    render();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  update();
}
init();
