import h5wasm from "./vendor/h5wasm/hdf5_hl.js";
import { makeLaea, makeConvergence } from "./laea.js";
import { GROUPS, VARIABLES, DEFAULT_VARIABLE, validLeads, ARROWS, WIND_DIR_REFERENCE } from "./variables.js";
import { REGION_GROUPS, REGIONS, DEFAULT_REGION } from "./regions.js";
import { SEQUENTIAL, DIVERGING } from "./palettes.js";

const BASE = "https://met-office-atmospheric-model-data.s3-eu-west-2.amazonaws.com/uk-deterministic-2km";
const AVAILABLE_AFTER_H = 4.5; // el ciclo completo se termina de subir ~4 h 15 min después de su hora
const HOUR = 3600e3;
const RAD = Math.PI / 180;
const NAME = { a: "Última salida", b: "Salida anterior", diff: "Diferencia" };

// Ciudades de referencia (solo punto, sin nombre).
const CITIES = [
  [-0.13, 51.51], [-1.90, 52.48], [-2.24, 53.48], [-1.55, 53.80], [-1.61, 54.98], [-3.19, 55.95],
  [-4.25, 55.86], [-2.10, 57.15], [-4.22, 57.48], [-5.93, 54.60], [-3.18, 51.48], [-2.59, 51.45],
  [-4.14, 50.37], [1.30, 52.63], [-1.40, 50.90], [-2.99, 53.41], [-1.47, 53.38], [-5.54, 50.12],
  [-1.15, 60.16], [-6.37, 58.21], [-3.00, 58.99], [-6.26, 53.35], [-3.53, 50.72], [-0.34, 53.74],
];

const $ = id => document.getElementById(id);
const pad = (n, w = 2) => String(n).padStart(w, "0");
// Número con signo explícito; un valor que se redondea a cero no lleva signo (evita "-0.0").
const signed = (v, dec) => { const t = v.toFixed(dec); return Number(t) === 0 ? t.replace("-", "") : v > 0 ? `+${t}` : t; };
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
// Paleta por nombre (docs/palettes.js), en su versión clara u oscura según el tema.
const lutCache = new Map();
function paletteLUT(name) {
  const key = name + (dark() ? ":d" : ":l");
  if (!lutCache.has(key)) {
    let stops;
    if (SEQUENTIAL[name]) stops = dark() ? (SEQUENTIAL[name].dark ?? SEQUENTIAL[name].stops) : SEQUENTIAL[name].stops;
    else if (DIVERGING[name]) stops = dark() ? DIVERGING[name].dark : DIVERGING[name].light;
    else throw new Error(`Paleta desconocida: ${name}`);
    lutCache.set(key, lut(stops));
  }
  return lutCache.get(key);
}
// Valor → posición en la paleta (0..1). Con `center`, el centro de la paleta cae en ese valor aunque no sea el punto medio.
const normalize = (v, lo, hi, center) => center == null
  ? (v - lo) / (hi - lo)
  : v < center ? 0.5 * (v - lo) / (center - lo) : 0.5 + 0.5 * (v - center) / (hi - center);
const lutIndex = (v, lo, hi, center) => Math.min(255, Math.max(0, Math.round(normalize(v, lo, hi, center) * 255))) * 4;
// Flechas: color + halo para que se lean sobre cualquier fondo.
const arrowStyle = () => dark()
  ? { A: "#f4f6f8", B: "#ffb454", halo: "rgba(0,0,0,0.75)" }
  : { A: "#111418", B: "#c2410c", halo: "rgba(255,255,255,0.85)" };

// ---------- Datos ----------
await h5wasm.ready;
const { FS } = await h5wasm.ready;
const cache = new Map();
let fileSeq = 0;

function cycleName(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}00Z`;
}
const urlFor = (cycleT, lead, file) =>
  `${BASE}/${cycleName(cycleT)}/${cycleName(cycleT + lead * HOUR)}-PT${pad(lead, 4)}H00M-${file}.nc`;

async function loadField(cycleT, lead, file) {
  const url = urlFor(cycleT, lead, file);
  if (cache.has(url)) return cache.get(url);
  let res = await fetch(url);
  if (res.status === 404) { // un 404 puntual se reintenta una vez antes de darlo por no disponible
    await new Promise(r => setTimeout(r, 800));
    res = await fetch(url);
  }
  if (res.status === 404 || res.status === 403) {
    throw new Error(`No disponible: ${url.split("/").slice(-2).join("/")} (la salida aún no está subida o ese alcance no existe).`);
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

// Una salida de una variable: {main} o, para el viento, {dir, speed}.
async function loadSet(cycleT, lead, cfg) {
  const files = cfg.files ?? { main: cfg.file };
  const entries = await Promise.all(Object.entries(files).map(async ([k, f]) => [k, await loadField(cycleT, lead, f)]));
  return Object.fromEntries(entries);
}

// ---------- Cálculo de capas ----------
// Devuelve, en la unidad mostrada: a (campo de la última salida) y, si hay salida anterior (SB), b y diff (diferencia).
// Para el viento añade dirección/velocidad crudas, de las que salen las flechas.
function compute(cfg, SA, SB) {
  const kind = cfg.kind ?? "scalar";
  const grid = (SA.main ?? SA.speed);
  const n = grid.nx * grid.ny;
  const diff = SB ? new Float32Array(n) : null;

  if (kind === "scalar") {
    const a = new Float32Array(n), b = SB ? new Float32Array(n) : null;
    for (let i = 0; i < n; i++) {
      a[i] = SA.main.data[i] * cfg.factor + cfg.offset;
      if (SB) {
        b[i] = SB.main.data[i] * cfg.factor + cfg.offset;
        diff[i] = (SA.main.data[i] - SB.main.data[i]) * cfg.factor;
      }
    }
    return { kind, grid, a, b, diff };
  }

  // Viento: dirección = de dónde sopla (grados, sentido horario desde el norte). Velocidades crudas en m/s.
  const sA = SA.speed.data, dA = SA.dir.data, sB = SB?.speed.data, dB = SB?.dir.data;
  const vf = cfg.viewFactor ?? 1, a = new Float32Array(n), b = SB ? new Float32Array(n) : null;
  for (let i = 0; i < n; i++) {
    a[i] = sA[i] * vf;
    if (!SB) continue;
    b[i] = sB[i] * vf;
    if (kind === "wdiff") {
      diff[i] = Math.min(sA[i], sB[i]) < cfg.minSpeed ? NaN : ((dA[i] - dB[i] + 540) % 360) - 180; // circular, (−180, 180]
    } else {
      const uA = -sA[i] * Math.sin(dA[i] * RAD), vA = -sA[i] * Math.cos(dA[i] * RAD);
      const uB = -sB[i] * Math.sin(dB[i] * RAD), vB = -sB[i] * Math.cos(dB[i] * RAD);
      diff[i] = Math.hypot(uA - uB, vA - vB) * cfg.factor; // invariante frente al giro de ejes
    }
  }
  return { kind, grid, a, b, diff, dirA: dA, dirB: dB ?? null, rawA: sA, rawB: sB ?? null, wind: true };
}

// Media por bloques de `step` celdas del viento (componentes este/norte verdaderas), girada a ejes de la malla
// si la dirección va respecto al norte verdadero. Devuelve flechas {px, py, u, v, s, m} en píxeles de la imagen.
const convergence = makeConvergence();
function arrowField(grid, speed, dir, step) {
  const { nx, ny, x0, dx, y0, dy } = grid;
  const out = [];
  for (let bj = 0; bj + step <= ny; bj += step) {
    for (let bi = 0; bi + step <= nx; bi += step) {
      let su = 0, sv = 0, ss = 0;
      for (let j = bj; j < bj + step; j++) {
        for (let i = bi; i < bi + step; i++) {
          const k = j * nx + i, s = speed[k], th = dir[k] * RAD;
          su -= s * Math.sin(th); sv -= s * Math.cos(th); ss += s;
        }
      }
      const cnt = step * step, ci = bi + step / 2, cj = bj + step / 2;
      let u = su / cnt, v = sv / cnt;
      if (WIND_DIR_REFERENCE === "north") {
        const g = convergence(x0 + ci * dx, y0 + cj * dy);
        [u, v] = [u * Math.cos(g) + v * Math.sin(g), -u * Math.sin(g) + v * Math.cos(g)];
      }
      out.push({ px: ci + 0.5, py: ny - cj - 0.5, u, v, s: ss / cnt, m: Math.hypot(u, v) });
    }
  }
  return out;
}

// ---------- Estado / UI ----------
const state = {
  cfg: null, layers: null, meta: null, token: 0,
  region: DEFAULT_REGION, shown: { a: true, b: false, diff: false },
  images: {}, arrowCache: new Map(),
  filter: { op: "none", v1: NaN, v2: NaN }, // filtro de valores: se muestran solo las celdas que cumplen
};
let panels = [];

function defaultCycle() {
  const now = Date.now();
  const day = Math.floor(now / 86400e3) * 86400e3;
  for (let d = 0; d <= 3; d++) for (const h of [15, 3]) {
    const t = day - d * 86400e3 + h * HOUR;
    if (t + AVAILABLE_AFTER_H * HOUR <= now) return t;
  }
}

// La salida anterior solo se descarga (y condiciona los alcances) si se muestra ella o la diferencia.
const needsB = () => state.shown.b || state.shown.diff;
const syncControls = () => { $("offset").disabled = !needsB(); };

let leads = []; // alcances válidos de la última salida para la variable y el desfase elegidos

function refreshLeads(wanted) {
  leads = validLeads(VARIABLES[$("variable").value], needsB() ? Number($("offset").value) : 0);
  $("lead").max = Math.max(0, leads.length - 1);
  let best = 0; // conserva el alcance pedido o el más cercano que exista
  leads.forEach((h, i) => { if (Math.abs(h - wanted) < Math.abs(leads[best] - wanted)) best = i; });
  $("lead").value = best;
}
const currentLead = () => leads[Number($("lead").value)];

function readControls() {
  const [y, m, d] = $("date").value.split("-").map(Number);
  const tA = Date.UTC(y, m - 1, d) + Number($("run").value) * HOUR;
  const lead = currentLead(), off = Number($("offset").value), key = $("variable").value;
  return { key, cfg: VARIABLES[key], tA, lead, tB: tA - off * HOUR, leadB: lead + off, off };
}
const fmt = t => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}Z`; };

// Solo errores: mientras carga no se muestra texto (cambiaba la altura de la página y desplazaba el mapa).
function setStatus(msg = "") { const s = $("status"); s.textContent = msg; s.className = "info" + (msg ? " err" : ""); }

async function update() {
  const c = readControls();
  const token = ++state.token;
  if (c.lead === undefined) { setStatus("Esta variable no tiene alcances comunes para ese desfase."); return; }
  $("leadLabel").textContent = `+${c.lead} h`;
  $("info").innerHTML = `Validez <b>${fmt(c.tA + c.lead * HOUR)}</b>`;
  setStatus();
  $("maps").classList.add("loading");
  try {
    const needB = needsB();
    const [SA, SB] = await Promise.all([loadSet(c.tA, c.lead, c.cfg), needB ? loadSet(c.tB, c.leadB, c.cfg) : null]);
    if (token !== state.token) return;
    state.cfg = c.cfg;
    state.layers = compute(c.cfg, SA, SB);
    state.meta = { a: `${fmt(c.tA)} +${c.lead} h`, b: needB ? `${fmt(c.tB)} +${c.leadB} h` : "" };
    state.images = {}; state.arrowCache.clear();
    drawAll();
    drawStats(c.cfg, state.layers);
    drawArrowKey();
  } catch (e) {
    if (token !== state.token) return;
    state.layers = null;
    for (const p of panels) p.canvas.getContext("2d").clearRect(0, 0, p.canvas.width, p.canvas.height);
    $("stats").innerHTML = ""; $("arrowkey").innerHTML = "";
    setStatus(e.message);
  } finally {
    if (token === state.token) $("maps").classList.remove("loading");
  }
}

// ---------- Paneles ----------
function buildPanels() {
  const kinds = ["a", "b", "diff"].filter(k => state.shown[k]);
  const maps = $("maps");
  maps.style.setProperty("--cols", kinds.length);
  maps.style.maxWidth = kinds.length === 1 ? "860px" : "";
  maps.style.margin = kinds.length === 1 ? "0 auto" : "";
  maps.innerHTML = "";
  panels = kinds.map(kind => {
    const fig = document.createElement("figure");
    fig.className = "map";
    fig.innerHTML = '<figcaption></figcaption><canvas></canvas><div class="legend"></div>';
    maps.append(fig);
    const canvas = fig.querySelector("canvas");
    canvas.addEventListener("pointermove", e => onMove(e, canvas, kind));
    canvas.addEventListener("pointerleave", () => { $("tip").style.display = "none"; });
    return { kind, canvas, caption: fig.querySelector("figcaption"), legend: fig.querySelector(".legend") };
  });
}

// Imagen (a resolución de malla) de cada mapa; se recorta y escala al dibujar, así el zoom no recalcula nada.
function getImage(kind) {
  if (state.images[kind]) return state.images[kind];
  const { cfg, layers } = state;
  const { nx, ny } = layers.grid, pal = cfg.palette ?? { map: "azul", diff: "azul-rojo" };
  let vals, lo, hi, table, center = null;
  if (kind === "diff") {
    vals = layers.diff; table = paletteLUT(pal.diff); // para "vector" el módulo no tiene signo: paleta secuencial
    [lo, hi] = layers.kind === "vector" ? [0, cfg.diffScale] : [-cfg.diffScale, cfg.diffScale];
  } else {
    vals = kind === "a" ? layers.a : layers.b;
    [lo, hi] = cfg.range; table = paletteLUT(pal.map); center = cfg.center ?? null;
  }
  const img = new ImageData(nx, ny), px = img.data;
  const m = filterMatcher(); // filtro: en la diferencia basta con que cumpla alguna de las dos salidas
  for (let r = 0; r < ny; r++) {
    const j = ny - 1 - r; // la malla va de sur a norte
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, v = vals[k];
      if (!Number.isFinite(v)) continue; // p. ej. viento flojo en la diferencia de dirección
      if (m && !(kind === "diff" ? m(layers.a[k]) || m(layers.b[k]) : m(v))) continue;
      const o = (r * nx + i) * 4;
      const t = lutIndex(v, lo, hi, center);
      px[o] = table[t]; px[o + 1] = table[t + 1]; px[o + 2] = table[t + 2]; px[o + 3] = 255;
    }
  }
  const off = document.createElement("canvas");
  off.width = nx; off.height = ny;
  off.getContext("2d").putImageData(img, 0, 0);
  return (state.images[kind] = { canvas: off, lo, hi, table, center });
}

const laea = makeLaea();
const toImagePx = (g, lon, lat) => {
  const [x, y] = laea(lon, lat);
  return [(x - g.x0) / g.dx + 0.5, g.ny - 1 - (y - g.y0) / g.dy + 0.5];
};

// Recorte (en píxeles de la imagen) de la zona elegida.
function getCrop(g) {
  const reg = REGIONS[state.region];
  if (!reg.box) return { sx: 0, sy: 0, sw: g.nx, sh: g.ny };
  const [w, s, e, n] = reg.box;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k <= 12; k++) { // se muestrean los bordes: la caja en lon/lat no es un rectángulo en la malla
    const t = k / 12, lon = w + (e - w) * t, lat = s + (n - s) * t;
    for (const [lo, la] of [[lon, s], [lon, n], [w, lat], [e, lat]]) {
      const [px, py] = toImagePx(g, lo, la);
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
  }
  const padX = (x1 - x0) * 0.02, padY = (y1 - y0) * 0.02;
  x0 = Math.max(0, x0 - padX); x1 = Math.min(g.nx, x1 + padX);
  y0 = Math.max(0, y0 - padY); y1 = Math.min(g.ny, y1 + padY);
  return { sx: x0, sy: y0, sw: x1 - x0, sh: y1 - y0 };
}

// ---------- Filtro de valores ----------
// Devuelve una función (valor en la unidad mostrada) → ¿cumple?, o null si no hay filtro activo.
function filterMatcher() {
  const { op, v1, v2 } = state.filter;
  if (op === "lt" && Number.isFinite(v1)) return v => v < v1;
  if (op === "gt" && Number.isFinite(v1)) return v => v > v1;
  if (op === "between" && Number.isFinite(v1) && Number.isFinite(v2)) {
    const lo = Math.min(v1, v2), hi = Math.max(v1, v2);
    return v => v >= lo && v <= hi;
  }
  return null;
}
const num = v => String(v).replace(".", ",");
function filterText() {
  if (!filterMatcher() || !state.cfg) return null;
  const { op, v1, v2 } = state.filter, u = state.cfg.viewUnit ?? state.cfg.unit;
  return op === "lt" ? `< ${num(v1)} ${u}` : op === "gt" ? `> ${num(v1)} ${u}` : `${num(Math.min(v1, v2))}–${num(Math.max(v1, v2))} ${u}`;
}

// La costa se carga antes de dibujar nada, para que drawPanel sea síncrono (sin carreras al redimensionar).
const coast = await (await fetch("coast.json")).json();

function drawAll() {
  for (const p of panels) drawPanel(p);
}

function drawPanel(p) {
  const L = state.layers;
  if (!L || (p.kind !== "a" && !L.b)) return; // la salida anterior aún se está descargando
  const img = getImage(p.kind), crop = getCrop(L.grid), cfg = state.cfg;
  const cssW = p.canvas.clientWidth || 320, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(cssW * dpr), H = Math.round(W * crop.sh / crop.sw);
  p.canvas.style.aspectRatio = `${crop.sw} / ${crop.sh}`;
  if (p.canvas.width !== W || p.canvas.height !== H) { p.canvas.width = W; p.canvas.height = H; }
  const ctx = p.canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img.canvas, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
  const f = W / crop.sw; // píxeles del lienzo por píxel de imagen
  const to = (lon, lat) => { const [px, py] = toImagePx(L.grid, lon, lat); return [(px - crop.sx) * f, (py - crop.sy) * f]; };

  const ink = dark() ? "230,233,237" : "27,31,36", ring = dark() ? "#1a1a19" : "#ffffff";
  ctx.lineJoin = "round";
  ctx.strokeStyle = `rgba(${ink},0.6)`; ctx.lineWidth = 1.3 * dpr;
  for (const line of coast) {
    ctx.beginPath();
    line.forEach(([lon, lat], k) => { const [x, y] = to(lon, lat); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
  if (L.wind) {
    const st = arrowStyle();
    if (p.kind !== "a" && L.rawB) drawArrows(ctx, "B", st.B, 1.8, crop, f, dpr, cssW);
    if (p.kind !== "b") drawArrows(ctx, "A", st.A, 1.6, crop, f, dpr, cssW);
  }
  for (const [lon, lat] of CITIES) {
    const [x, y] = to(lon, lat);
    if (x < 0 || y < 0 || x > W || y > H) continue;
    ctx.beginPath(); ctx.arc(x, y, 5.5 * dpr, 0, 7); ctx.fillStyle = ring; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 3.5 * dpr, 0, 7); ctx.fillStyle = `rgb(${ink})`; ctx.fill();
  }

  // Título y leyenda
  const meta = p.kind === "diff" ? "última − anterior" : state.meta[p.kind];
  const ft = filterText();
  p.caption.innerHTML = `<b>${NAME[p.kind]}</b> <span>· ${meta}</span>` +
    // línea reservada aunque no haya filtro: así activarlo o quitarlo no desplaza los mapas
    `<span class="flt">${ft ? `${p.kind === "diff" ? "donde alguna salida cumple" : "solo"}: ${ft}` : ""}</span>`;
  drawLegend(p, cfg, L, img);
}

function drawArrows(ctx, which, color, width, crop, f, dpr, cssW) {
  const L = state.layers, g = L.grid, st = arrowStyle();
  // la densidad se mide en píxeles de pantalla: al hacer zoom aparecen más flechas
  const step = Math.min(120, Math.max(2, Math.round(ARROWS.spacing / (cssW / crop.sw))));
  const key = `${which}:${step}`;
  if (!state.arrowCache.has(key)) {
    state.arrowCache.set(key, arrowField(g, which === "A" ? L.rawA : L.rawB, which === "A" ? L.dirA : L.dirB, step));
  }
  const maxLen = ARROWS.spacing * 0.95 * dpr, minLen = ARROWS.minLen * dpr;
  const path = new Path2D(), m = filterMatcher(), vf = state.cfg.viewFactor ?? 1;
  for (const a of state.arrowCache.get(key)) {
    if (m && !m(a.s * vf)) continue;
    const x = (a.px - crop.sx) * f, y = (a.py - crop.sy) * f;
    if (x < -maxLen || y < -maxLen || x > crop.sw * f + maxLen || y > crop.sh * f + maxLen) continue;
    if (a.s < ARROWS.minSpeed || a.m < 1e-6) continue;
    const len = minLen + (maxLen - minLen) * Math.min(a.s / ARROWS.vref, 1);
    const ux = a.u / a.m, uy = -a.v / a.m; // el eje y del lienzo crece hacia abajo
    const hx = x + ux * len / 2, hy = y + uy * len / 2, tx = x - ux * len / 2, ty = y - uy * len / 2;
    const h = Math.min(5 * dpr, len * 0.4), ang = Math.atan2(uy, ux);
    path.moveTo(tx, ty); path.lineTo(hx, hy);
    for (const s of [-1, 1]) {
      path.moveTo(hx, hy);
      path.lineTo(hx - h * Math.cos(ang + s * 0.45), hy - h * Math.sin(ang + s * 0.45));
    }
  }
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = st.halo; ctx.lineWidth = (width + 2.4) * dpr; ctx.stroke(path);
  ctx.strokeStyle = color; ctx.lineWidth = width * dpr; ctx.stroke(path);
}

function drawLegend(p, cfg, layers, img) {
  const lg = p.legend;
  lg.innerHTML = "";
  const left = document.createElement("span"), right = document.createElement("span");
  const bar = document.createElement("canvas"); bar.width = 256; bar.height = 1;
  const id = new ImageData(256, 1);
  for (let i = 0; i < 256; i++) { // misma normalización que el mapa (el centro puede no estar a mitad de barra)
    const t = lutIndex(img.lo + (img.hi - img.lo) * i / 255, img.lo, img.hi, img.center);
    id.data.set(img.table.subarray(t, t + 4), i * 4);
  }
  bar.getContext("2d").putImageData(id, 0, 0);
  const vu = cfg.viewUnit ?? cfg.unit;
  if (p.kind !== "diff") {
    left.textContent = `${img.lo} ${vu}`;
    right.textContent = img.center == null ? `${img.hi} ${vu}` : `centro ${img.center} ${vu} · ${img.hi} ${vu}`;
  } else if (layers.kind === "vector") {
    left.textContent = `0 ${cfg.unit}`; right.textContent = `${img.hi} ${cfg.unit} · módulo de la diferencia`;
  } else {
    left.textContent = `${img.lo} ${cfg.unit} · última ${cfg.neg}`; right.textContent = `última ${cfg.pos} · +${img.hi} ${cfg.unit}`;
  }
  lg.append(bar, left, right);
}

function drawArrowKey() {
  const el = $("arrowkey"), L = state.layers;
  if (!L?.wind) { el.innerHTML = ""; return; }
  const st = arrowStyle(), sw = c => `<b style="background:${c}"></b>`;
  const parts = [
    state.shown.a || state.shown.diff ? `${sw(st.A)} ${NAME.a}` : null,
    L.b && (state.shown.b || state.shown.diff) ? `${sw(st.B)} ${NAME.b}` : null,
  ].filter(Boolean).join(" · ");
  const both = state.shown.diff ? " (en la diferencia se muestran ambas)" : "";
  el.innerHTML = `Flechas: ${parts}${both} — hacia donde sopla; longitud ∝ velocidad (máx. ${Math.round(ARROWS.vref * (state.cfg.viewFactor ?? 1))} ${state.cfg.viewUnit ?? "m/s"})`;
}

function diffTiles(cfg, layers, m) {
  const diff = layers.diff;
  let pass = 0, n = 0, sum = 0, sq = 0, ab = 0, mx = -Infinity, mn = Infinity, gt = 0;
  for (let k = 0; k < diff.length; k++) {
    if (m && !(m(layers.a[k]) || m(layers.b[k]))) continue;
    pass++;
    const d = diff[k];
    if (!Number.isFinite(d)) continue;
    n++; sum += d; sq += d * d; ab += Math.abs(d);
    if (d > mx) mx = d; if (d < mn) mn = d; if (Math.abs(d) > cfg.thresh) gt++;
  }
  const dec = cfg.decimals + 1, u = ` ${cfg.unit}`;
  const sg = v => signed(v, dec), pc = (x, t) => t ? `${(100 * x / t).toFixed(1)} %` : "—";
  let tiles;
  if (n === 0) tiles = [["Diferencia", "sin celdas"]];
  else if (layers.kind === "vector") {
    tiles = [
      ["Módulo medio de la diferencia", (sum / n).toFixed(dec) + u],
      ["Error cuadrático medio", Math.sqrt(sq / n).toFixed(dec) + u],
      ["Máximo", mx.toFixed(dec) + u],
      [`Celdas con diferencia > ${cfg.thresh}${u}`, pc(gt, n)],
    ];
  } else {
    tiles = [
      ["Diferencia media", sg(sum / n) + u],
      ["Diferencia absoluta media", (ab / n).toFixed(dec) + u],
      ["Error cuadrático medio", Math.sqrt(sq / n).toFixed(dec) + u],
      [`Última ${cfg.pos} (máx.)`, sg(mx) + u],
      [`Última ${cfg.neg} (máx.)`, sg(mn) + u],
      [`Celdas con |Δ| > ${cfg.thresh}${u}`, pc(gt, n)],
    ];
    if (layers.kind === "wdiff") {
      // los extremos de una diferencia circular (±180°) no informan: se sustituyen por la cobertura de la máscara
      tiles.splice(3, 2);
      tiles.push([`Celdas con viento ≥ ${Math.round(cfg.minSpeed * cfg.viewFactor)} ${cfg.viewUnit} en ambas salidas`, pc(n, pass)]);
    }
  }
  if (m) tiles.push(["Celdas que cumplen el filtro (alguna salida)", pc(pass, diff.length)]);
  return tiles;
}

// Mínimo, media y máximo de los datos de cada mapa en bruto mostrado (solo de las celdas que cumplen el filtro).
function rawTiles(cfg, layers, arr, name, m) {
  let n = 0, total = 0, sum = 0, mn = Infinity, mx = -Infinity;
  for (const v of arr) {
    if (!Number.isFinite(v)) continue;
    total++;
    if (m && !m(v)) continue;
    n++; sum += v; if (v < mn) mn = v; if (v > mx) mx = v;
  }
  const vd = cfg.viewDecimals ?? cfg.decimals, vu = ` ${cfg.viewUnit ?? cfg.unit}`, w = layers.wind ? " · velocidad" : "";
  const tiles = n === 0
    ? [[`${name}${w}`, "sin celdas"]]
    : [[`${name}${w} · mínimo`, mn.toFixed(vd) + vu], [`${name}${w} · media`, (sum / n).toFixed(vd) + vu], [`${name}${w} · máximo`, mx.toFixed(vd) + vu]];
  if (m) tiles.push([`${name} · celdas que cumplen el filtro`, `${(100 * n / total).toFixed(1)} %`]);
  return tiles;
}

function drawStats(cfg, layers) {
  const m = filterMatcher(), tiles = [];
  if (state.shown.a) tiles.push(...rawTiles(cfg, layers, layers.a, NAME.a, m));
  if (state.shown.b && layers.b) tiles.push(...rawTiles(cfg, layers, layers.b, NAME.b, m));
  if (state.shown.diff && layers.diff) tiles.push(...diffTiles(cfg, layers, m));
  $("stats").innerHTML = tiles.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("");
}

// ---------- Tooltip ----------
const tip = $("tip");
function onMove(e, canvas, kind) {
  const { cfg, layers } = state;
  if (!layers || (kind !== "a" && !layers.b)) return;
  const g = layers.grid, crop = getCrop(g), r = canvas.getBoundingClientRect();
  const px = crop.sx + (e.clientX - r.left) / r.width * crop.sw, py = crop.sy + (e.clientY - r.top) / r.height * crop.sh;
  const i = Math.floor(px), j = g.ny - 1 - Math.floor(py);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) { tip.style.display = "none"; return; }
  const k = j * g.nx + i;
  const dec = cfg.decimals, vd = cfg.viewDecimals ?? cfg.decimals, vu = cfg.viewUnit ?? cfg.unit;
  const muted = t => `<span style="color:var(--muted)">${t}</span>`;
  let html;
  if (kind !== "diff") {
    // Mapa en bruto: valor absoluto de esa salida (en el viento, velocidad y dirección).
    const arr = kind === "a" ? layers.a : layers.b, dirs = kind === "a" ? layers.dirA : layers.dirB;
    html = layers.kind === "scalar"
      ? `${muted(NAME[kind])}<br><b>${arr[k].toFixed(dec)}</b> ${cfg.unit}`
      : `${muted(`${NAME[kind]} · velocidad y dirección`)}<br><b>${arr[k].toFixed(vd)}</b> ${vu} · <b>${Math.round(dirs[k])}°</b>`;
  } else {
    const d = layers.diff[k];
    const dtxt = Number.isFinite(d) ? `${signed(d, dec)} ${cfg.unit}` : "sin dato (viento flojo)";
    if (layers.kind === "scalar") {
      html = `Δ <b>${dtxt}</b><br>Última <b>${layers.a[k].toFixed(dec)}</b> · Anterior <b>${layers.b[k].toFixed(dec)}</b> ${cfg.unit}`;
    } else {
      const line = (n, sp, dir) => `${n} <b>${sp.toFixed(vd)}</b> ${vu} · <b>${Math.round(dir)}°</b>`;
      html = `${layers.kind === "vector" ? "|Δ vector|" : "Δ dirección"} <b>${dtxt}</b><br>${line("Última", layers.a[k], layers.dirA[k])}<br>${line("Anterior", layers.b[k], layers.dirB[k])}`;
    }
  }
  tip.innerHTML = html;
  tip.style.display = "block";
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 200) + "px";
  tip.style.top = e.clientY + 14 + "px";
}

// ---------- Interfaz del filtro ----------
const currentCfg = () => VARIABLES[$("variable").value];

// Refleja state.filter en los controles: unidad, paso, atajos de la variable y qué entradas están activas.
function syncFilterUI() {
  const cfg = currentCfg(), f = state.filter, step = Math.pow(10, -cfg.decimals);
  $("fop").value = f.op;
  $("funit").textContent = cfg.viewUnit ?? cfg.unit;
  for (const [id, v, on] of [["fv1", f.v1, f.op !== "none"], ["fv2", f.v2, f.op === "between"]]) {
    const el = $(id);
    el.disabled = !on; el.step = step;
    el.value = on && Number.isFinite(v) ? v : "";
  }
  $("fpresets").innerHTML = (cfg.filterPresets ?? []).map((pr, i) => {
    const on = f.op === pr.op && f.v1 === pr.v && (pr.op !== "between" || f.v2 === pr.v2);
    return `<button data-i="${i}" aria-pressed="${on}">${pr.label}</button>`;
  }).join("");
}

// Aplica el filtro: no hay que descargar nada, solo repintar mapas, flechas y estadísticas.
function applyFilter() {
  state.images = {};
  if (!state.layers) return;
  drawAll();
  drawStats(state.cfg, state.layers);
}

function initFilter() {
  let timer;
  $("fop").addEventListener("input", () => {
    const cfg = currentCfg(), op = $("fop").value, f = state.filter;
    if (op !== "none" && !Number.isFinite(f.v1)) f.v1 = cfg.filterPresets?.[0]?.v ?? cfg.range[0]; // valor de partida
    if (op === "between" && !Number.isFinite(f.v2)) f.v2 = Math.max(f.v1 + 1, cfg.range[1]);
    f.op = op;
    syncFilterUI(); applyFilter();
  });
  for (const id of ["fv1", "fv2"]) {
    $(id).addEventListener("input", () => {
      state.filter.v1 = $("fv1").valueAsNumber; state.filter.v2 = $("fv2").valueAsNumber;
      clearTimeout(timer); timer = setTimeout(() => { applyFilter(); $("fpresets").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", "false")); }, 120);
    });
  }
  $("fpresets").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    const pr = currentCfg().filterPresets[Number(b.dataset.i)];
    const same = state.filter.op === pr.op && state.filter.v1 === pr.v;
    state.filter = same ? { op: "none", v1: NaN, v2: NaN } : { op: pr.op, v1: pr.v, v2: pr.v2 ?? NaN }; // otro clic lo quita
    syncFilterUI(); applyFilter();
  });
}

// ---------- Eventos ----------
function init() {
  const t = defaultCycle(), d = new Date(t);
  $("date").value = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  $("run").value = pad(d.getUTCHours());

  $("variable").innerHTML = GROUPS.map(g =>
    `<optgroup label="${g.label}">${Object.entries(VARIABLES).filter(([, v]) => v.group === g.id)
      .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("")}</optgroup>`).join("");
  $("variable").value = DEFAULT_VARIABLE;
  $("region").innerHTML = REGION_GROUPS.map(g =>
    `<optgroup label="${g.label}">${g.regions.map(r => `<option value="${r.id}">${r.label}</option>`).join("")}</optgroup>`).join("");
  $("region").value = DEFAULT_REGION;
  syncControls();
  refreshLeads(24);
  buildPanels();
  syncFilterUI(); initFilter();

  $("variable").addEventListener("input", () => {
    const keep = currentLead(); refreshLeads(keep);
    state.filter = { op: "none", v1: NaN, v2: NaN }; syncFilterUI(); // otra variable, otra unidad: el filtro se reinicia
    update();
  });
  $("offset").addEventListener("input", () => { refreshLeads(currentLead()); update(); });
  for (const id of ["date", "run"]) $(id).addEventListener("input", update);
  // El deslizador actualiza la etiqueta al instante y descarga al soltar/pausar, no en cada paso.
  let timer;
  $("lead").addEventListener("input", () => {
    $("leadLabel").textContent = `+${currentLead()} h`;
    clearTimeout(timer); timer = setTimeout(update, 150);
  });
  const nudge = k => { $("lead").value = Math.min(leads.length - 1, Math.max(0, Number($("lead").value) + k)); update(); };
  $("prev").onclick = () => nudge(-1);
  $("next").onclick = () => nudge(1);

  $("region").addEventListener("input", () => { state.region = $("region").value; drawAll(); });
  $("panels").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    const k = b.dataset.k;
    if (state.shown[k] && Object.values(state.shown).filter(Boolean).length === 1) return; // al menos un mapa
    state.shown[k] = !state.shown[k];
    b.setAttribute("aria-pressed", state.shown[k]);
    syncControls(); refreshLeads(currentLead()); // sin salida anterior no hace falta que exista a +12 h, +24 h…
    buildPanels(); update(); // descarga la salida anterior solo si ahora hace falta
  });

  let raf;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawAll); }).observe($("maps"));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { state.images = {}; drawAll(); });
  update();
}
init();
