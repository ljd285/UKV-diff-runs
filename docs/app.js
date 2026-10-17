import h5wasm from "./vendor/h5wasm/hdf5_hl.js";
import { makeLaea, makeLaeaInverse, makeConvergence } from "./laea.js";
import { GROUPS, VARIABLES, DEFAULT_VARIABLE, validLeads, ARROWS, WIND_DIR_REFERENCE } from "./variables.js";
import { REGION_GROUPS, REGIONS, DEFAULT_REGION } from "./regions.js";
import { SEQUENTIAL, DIVERGING } from "./palettes.js";
import { smoothField, contourLevels, buildContours } from "./contours.js";

const BASE = "https://met-office-atmospheric-model-data.s3-eu-west-2.amazonaws.com/uk-deterministic-2km";
const AVAILABLE_AFTER_H = 4.5; // el ciclo completo se termina de subir ~4 h 15 min después de su hora
const HOUR = 3600e3;
const RAD = Math.PI / 180;
const LANDSEA_FILE = "landsea_mask"; // 1 = tierra, 0 = mar; igual en todas las salidas, como el relieve
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
const fixed = (v, dec) => { const t = v.toFixed(dec); return Number(t) === 0 ? t.replace("-", "") : t; }; // sin «-0.0»
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
// Caché de campos (Float32, ~4 MB cada uno). Con límite: sin él, recorrer alcances de un acumulado de 12 h llenaría la memoria.
const cache = new Map(), CACHE_MAX = 60;
const cacheGet = key => { const v = cache.get(key); if (v) { cache.delete(key); cache.set(key, v); } return v; }; // el más usado, al final
function cacheSet(key, v) {
  cache.delete(key); cache.set(key, v);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); // se descarta el menos usado
}
let fileSeq = 0;

function cycleName(t) {
  const d = new Date(t);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}00Z`;
}
const urlFor = (cycleT, lead, file) =>
  `${BASE}/${cycleName(cycleT)}/${cycleName(cycleT + lead * HOUR)}-PT${pad(lead, 4)}H00M-${file}.nc`;

async function loadField(cycleT, lead, file) {
  const url = urlFor(cycleT, lead, file);
  if (cache.has(url)) return cacheGet(url);
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
    cacheSet(url, field);
    return field;
  } finally {
    f.close();
    FS.unlink(path);
  }
}

// Acumulado de `accum.hours` horas que termina en `lead`: suma los ficheros que cubren (lead − N, lead].
// Hasta +54 h cada fichero es la hora anterior; desde +57 h, las 3 h anteriores (solo existen en múltiplos de 3 desde +54 h).
async function loadAccum(cycleT, lead, cfg) {
  const { hours, hourly, block, op = "sum" } = cfg.accum, key = `acc:${cycleName(cycleT)}:${lead}:${hours}:${hourly}:${op}`;
  if (cache.has(key)) return { main: cacheGet(key) };
  const parts = [];
  for (let h = lead - hours + 1; h <= lead; h++) {
    if (!block || h <= 54) parts.push(loadField(cycleT, h, hourly));
    else if ((h - 54) % 3 === 0) parts.push(loadField(cycleT, h, block));
  }
  const fields = await Promise.all(parts);
  const sum = Float32Array.from(fields[0].data); // suma, máximo o mínimo de los ficheros del periodo
  for (const f of fields.slice(1)) {
    for (let i = 0; i < sum.length; i++) {
      const v = f.data[i];
      sum[i] = op === "max" ? Math.max(sum[i], v) : op === "min" ? Math.min(sum[i], v) : sum[i] + v;
    }
  }
  const out = { ...fields[0], data: sum };
  cacheSet(key, out);
  return { main: out };
}

// Una salida de una variable: {main} o, para el viento, {dir, speed}.
async function loadSet(cycleT, lead, cfg) {
  if (cfg.accum) return loadAccum(cycleT, lead, cfg);
  // fileByLead: el nombre del fichero cambia con el alcance (PT01H hasta +54 h, PT03H desde +57 h)
  const files = cfg.files ?? { main: cfg.fileByLead ? (lead <= 54 ? cfg.fileByLead.hourly : cfg.fileByLead.block) : cfg.file };
  const entries = await Promise.all(Object.entries(files).map(async ([k, f]) => [k, await loadField(cycleT, lead, f)]));
  return Object.fromEntries(entries);
}

// ---------- Cálculo de capas ----------
// Devuelve, en la unidad mostrada: a (campo de la última salida) y, si hay salida anterior (SB), b y diff (diferencia).
// Para el viento añade dirección/velocidad crudas, de las que salen las flechas.
function compute(cfg, SA, SB, orog) {
  const kind = cfg.kind ?? "scalar";
  const grid = (SA.main ?? SA.speed);
  const n = grid.nx * grid.ny;
  const diff = SB ? new Float32Array(n) : null;

  if (kind === "scalar") {
    const a = new Float32Array(n), b = SB ? new Float32Array(n) : null;
    // addTerrain: el fichero da la altura sobre el suelo; se suma el relieve para mostrarla sobre el nivel del mar
    const t = cfg.addTerrain && orog ? orog : null;
    for (let i = 0; i < n; i++) {
      a[i] = SA.main.data[i] * cfg.factor + cfg.offset + (t ? t[i] : 0);
      if (SB) {
        b[i] = SB.main.data[i] * cfg.factor + cfg.offset + (t ? t[i] : 0);
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
  images: {}, arrowCache: new Map(), contourCache: {}, contours: false,
  marks: "none", scope: "view", marksCache: {}, scopeMaskCache: null, // valores sobre el mapa y ámbito de estadísticas/marcas
  filter: { op: "none", v1: NaN, v2: NaN }, // filtro de valores: se muestran solo las celdas que cumplen
  elev: { min: NaN, max: NaN },             // filtro de altitud del terreno: [min, max) en metros
  surface: "all",                           // filtro de superficie: "all" | "land" | "sea"
  orog: null, land: null, cellMask: null,               // altura del terreno (m) y máscara 0/1 del filtro de altitud
  // Modo «dos variables»: el segundo mapa tiene su propio contexto (variable, datos, filtro de valores, cachés).
  // `withCtx` lo intercambia con los campos de `state` mientras se dibuja, así el resto del código no cambia.
  pm: null, // presión para las altas y bajas: {cfg, layers, cache}
  ovKey: "same", ov: null, // isolíneas de otra variable (ovKey) y sus datos ({cfg, layers, contourCache})
  dual: false, savedShown: null,
  sec: { cfg: null, layers: null, meta: null, filter: { op: "none", v1: NaN, v2: NaN }, images: {}, arrowCache: new Map(),
         contourCache: {}, marksCache: {}, shown: { a: true, b: false, diff: false } },
};
const CTX_KEYS = ["cfg", "layers", "meta", "filter", "images", "arrowCache", "contourCache", "marksCache", "shown"];
function withCtx(ctx, fn) {
  if (!ctx) return fn();
  const saved = CTX_KEYS.map(k => state[k]);
  CTX_KEYS.forEach(k => { state[k] = ctx[k]; });
  try { return fn(); } finally { CTX_KEYS.forEach((k, i) => { ctx[k] = state[k]; state[k] = saved[i]; }); }
}
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
const isStatic = () => !!VARIABLES[$("variable").value].static && (!state.dual || !!VARIABLES[$("variable2").value].static); // p. ej. el relieve: no cambia con la salida
const needsB = () => !state.dual && !isStatic() && (state.shown.b || state.shown.diff);
const syncControls = () => {
  const st = isStatic();
  $("offset").disabled = !needsB();
  $("lead").disabled = $("prev").disabled = $("next").disabled = st;
  for (const b of $("panels").querySelectorAll("button")) b.disabled = st && b.dataset.k !== "a"; // sin comparación
  $("panels").closest("label").hidden = state.dual; // con dos variables solo se ve la última salida de cada una
  $("var2row").hidden = $("filterRow2").hidden = !state.dual;
  $("varlabel").textContent = state.dual ? "Variable del mapa 1" : "Variable";
  $("fltlabel").textContent = state.dual ? "Filtro de valores del mapa 1" : "Filtro de valores";
};
const panelName = kind => state.cfg?.static ? "Terreno del modelo" : NAME[kind];

let leads = []; // alcances válidos de la última salida para la variable y el desfase elegidos

// Variable de las isolíneas cuando no es la del mapa (null si se usan las de la propia variable o no hay isolíneas).
function overlayCfg() {
  if (!state.contours || state.ovKey === "same" || (!state.dual && VARIABLES[$("variable").value].static)) return null;
  return VARIABLES[state.ovKey];
}

// Presión para las altas y bajas (modo «Altas y bajas de presión» de los valores sobre el mapa); no se ofrece con el relieve como único mapa.
const pressureCfg = () => state.marks === "highlow" && (state.dual || !VARIABLES[$("variable").value].static) ? VARIABLES.pmsl : null;

function refreshLeads(wanted) {
  const off = needsB() ? Number($("offset").value) : 0, ch = new Date(runTime()).getUTCHours(), step = Number($("frames").value);
  // solo los alcances en que existen todas las variables en juego (mapas e isolíneas de otra variable); la estática, como el relieve, no limita
  const ov = overlayCfg();
  const pc = pressureCfg();
  const cfgs = [VARIABLES[$("variable").value], ...(state.dual ? [VARIABLES[$("variable2").value]] : []), ...(ov ? [ov] : []), ...(pc ? [pc] : [])];
  const varying = cfgs.filter(c => !c.static);
  leads = varying.length ? varying.map(c => validLeads(c, off, ch, step)).reduce((a, b) => a.filter(h => b.includes(h))) : [0];
  wanted ??= 24;
  $("lead").max = Math.max(0, leads.length - 1);
  let best = 0; // conserva el alcance pedido o el más cercano que exista
  leads.forEach((h, i) => { if (Math.abs(h - wanted) < Math.abs(leads[best] - wanted)) best = i; });
  $("lead").value = best;
}
const currentLead = () => leads[Number($("lead").value)];

function runTime() {
  const [y, m, d] = $("date").value.split("-").map(Number);
  return Date.UTC(y, m - 1, d) + Number($("run").value) * HOUR;
}

function readControls() {
  const tA = runTime();
  const lead = currentLead(), off = Number($("offset").value), key = $("variable").value;
  return { key, cfg: VARIABLES[key], tA, lead, tB: tA - off * HOUR, leadB: lead + off, off };
}
// Fechas en español, siempre en UTC ("Z"): "21Z Sábado 10 de octubre", y su forma corta "21Z sáb 10 oct" para los títulos.
const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const hourText = t => `${pad(new Date(t).getUTCHours())}Z`;
const dayText = t => { const d = new Date(t); return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`; };
const stampText = t => `${hourText(t)} ${dayText(t)}`;
const shortStamp = t => { const d = new Date(t); return `${hourText(t)} ${WEEKDAYS[d.getUTCDay()].slice(0, 3).toLowerCase()} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`; };
// Pronóstico: "+30h 21Z Sábado 10 de octubre" (alcance y hora/fecha de validez de una salida iniciada en `tInit`).
const fcText = (tInit, lead) => `+${lead}h ${stampText(tInit + lead * HOUR)}`;
const sameDay = (t1, t2) => new Date(t1).toUTCString().slice(0, 16) === new Date(t2).toUTCString().slice(0, 16);

// Solo errores: mientras carga no se muestra texto (cambiaba la altura de la página y desplazaba el mapa).
function setStatus(msg = "") { const s = $("status"); s.textContent = msg; s.className = "info" + (msg ? " err" : ""); }

// Descarga (alcance 0 de la salida elegida) lo que aún no se tenga; un fallo no impide ver la variable.
async function loadStatics(tA, skipOrog) {
  const get = file => loadField(tA, 0, file).then(f => f.data).catch(() => null);
  const [orog, land] = await Promise.all([!state.orog && !skipOrog ? get(VARIABLES.orog.file) : null, !state.land ? get(LANDSEA_FILE) : null]);
  return { orog, land };
}

// Texto de validez de la variable `cfg` (o del acumulado / máximo del periodo) para el alcance `c.lead`.
function infoText(cfg, c) {
  if (cfg.static) return "Relieve del modelo UKV 2 km · no varía con la salida ni con el alcance";
  if (cfg.accum) { // misma fecha: "de 06Z a 12Z del Sábado 10 de octubre"; si no, las dos con su fecha
    const t0 = c.tA + (c.lead - cfg.accum.hours) * HOUR, t1 = c.tA + c.lead * HOUR;
    return `${cfg.accum.title ?? "Acumulado de"} <b>${cfg.accum.hours} h</b> · ` + (sameDay(t0, t1)
      ? `de ${hourText(t0)} a <b>${hourText(t1)}</b> del ${dayText(t1)} (validez)`
      : `de ${stampText(t0)} a <b>${stampText(t1)}</b> (validez)`);
  }
  return `Validez <b>${stampText(c.tA + c.lead * HOUR)}</b>` + (cfg.fileByLead ? ` · máximo de ${c.lead <= 54 ? "la hora previa" : "las 3 h previas"}` : "");
}
const metaFor = (cfg, c) => cfg.static ? { a: { run: "UKV 2 km", fc: "" } } : { a: { run: `salida ${shortStamp(c.tA)}`, fc: fcText(c.tA, c.lead) } };

async function update() {
  const c = readControls();
  const token = ++state.token;
  if (c.lead === undefined) { setStatus("No hay alcances comunes para ese desfase y esos fotogramas."); return; }
  const dual = state.dual, cfg2 = dual ? VARIABLES[$("variable2").value] : null;
  $("leadLabel").textContent = isStatic() ? "no aplica" : fcText(c.tA, c.lead);
  $("info").innerHTML = dual
    ? `<b>${c.cfg.label}</b>: ${infoText(c.cfg, c)}<br><b>${cfg2.label}</b>: ${infoText(cfg2, c)}`
    : infoText(c.cfg, c);
  setStatus();
  $("maps").classList.add("loading");
  try {
    const needB = needsB();
    // El relieve y la máscara tierra/mar son iguales en todas las salidas: se descargan una vez por sesión
    // (para los filtros de altitud y superficie y para el tooltip).
    const staticP = loadStatics(c.tA, c.cfg.static);
    const leadOf = cfg => cfg.static ? 0 : c.lead; // el relieve se lee siempre del alcance 0
    const ovc = overlayCfg(), pmc = pressureCfg();
    const [SA, SB, st, S2, OA, OB, PA, PB] = await Promise.all([loadSet(c.tA, leadOf(c.cfg), c.cfg), needB ? loadSet(c.tB, c.leadB, c.cfg) : null, staticP,
      dual ? loadSet(c.tA, leadOf(cfg2), cfg2) : null,
      ovc ? loadSet(c.tA, leadOf(ovc), ovc) : null, ovc && needB ? loadSet(c.tB, c.leadB, ovc) : null,
      pmc ? loadSet(c.tA, c.lead, pmc) : null, pmc && needB ? loadSet(c.tB, c.leadB, pmc) : null]);
    if (token !== state.token) return;
    if (!state.orog) state.orog = c.cfg.static ? SA.main.data : st.orog; // si es la variable "relieve", ya está en SA
    if (!state.orog && dual && cfg2.static) state.orog = S2.main.data;
    if (!state.land) state.land = st.land;
    rebuildCellMask();
    syncElevUI();
    state.cfg = c.cfg;
    state.layers = compute(c.cfg, SA, SB, state.orog);
    state.meta = c.cfg.static
      ? { a: { run: "UKV 2 km", fc: "" } }
      : { a: { run: `salida ${shortStamp(c.tA)}`, fc: fcText(c.tA, c.lead) },
          b: needB ? { run: `salida ${shortStamp(c.tB)}`, fc: fcText(c.tB, c.leadB) } : null,
          diff: { run: "última − anterior", fc: `validez ${stampText(c.tA + c.lead * HOUR)}` } };
    state.images = {}; state.arrowCache.clear(); state.contourCache = {}; state.marksCache = {}; state.scopeMaskCache = null;
    state.pm = pmc ? { cfg: pmc, layers: compute(pmc, PA, PB, null), cache: {} } : null; // para las altas y bajas
    state.ov = ovc ? { cfg: ovc, layers: compute(ovc, OA, OB, state.orog), contourCache: {} } : null; // isolíneas de otra variable
    if (dual) { // contexto del segundo mapa: se reinician sus cachés (el filtro de valores se conserva)
      Object.assign(state.sec, { cfg: cfg2, layers: compute(cfg2, S2, null, state.orog), meta: metaFor(cfg2, c),
        images: {}, arrowCache: new Map(), contourCache: {}, marksCache: {}, shown: { a: true, b: false, diff: false } });
    }
    drawAll();
    drawStats(c.cfg, state.layers);
    drawArrowKey();
  } catch (e) {
    if (token !== state.token) return;
    state.layers = null; state.sec.layers = null;
    for (const p of panels) p.canvas.getContext("2d").clearRect(0, 0, p.canvas.width, p.canvas.height);
    $("stats").innerHTML = ""; $("arrowkey").innerHTML = "";
    setStatus(e.message);
  } finally {
    if (token === state.token) $("maps").classList.remove("loading");
  }
}

// ---------- Paneles ----------
function buildPanels() {
  // dos variables: dos mapas de la última salida (el segundo con su propio contexto); si no, los que se hayan elegido
  const specs = state.dual ? [{ kind: "a", ctx: null }, { kind: "a", ctx: state.sec }]
    : ["a", "b", "diff"].filter(k => state.shown[k]).map(kind => ({ kind, ctx: null }));
  const maps = $("maps");
  maps.style.setProperty("--cols", specs.length);
  maps.innerHTML = "";
  panels = specs.map(({ kind, ctx }) => {
    const fig = document.createElement("figure");
    fig.className = "map";
    fig.innerHTML = '<figcaption></figcaption><canvas></canvas><i class="xh" hidden></i><div class="legend"></div>';
    maps.append(fig);
    const canvas = fig.querySelector("canvas");
    canvas.addEventListener("pointermove", e => onMove(e, canvas, kind));
    canvas.addEventListener("pointerleave", () => { $("tip").style.display = "none"; for (const q of panels) q.xh.hidden = true; });
    return { kind, ctx, canvas, xh: fig.querySelector(".xh"), caption: fig.querySelector("figcaption"), legend: fig.querySelector(".legend") };
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
  const m = filterMatcher(), em = state.cellMask, mv = cfg.minValue ?? null, xv = cfg.maxValue ?? null; // filtro: en la diferencia basta con que cumpla alguna de las dos salidas
  for (let r = 0; r < ny; r++) {
    const j = ny - 1 - r; // la malla va de sur a norte
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, v = vals[k];
      if (!Number.isFinite(v)) continue; // p. ej. viento flojo en la diferencia de dirección
      if (em && !em[k]) continue;
      // por debajo del mínimo no se pinta; en la diferencia, solo si lo está en las dos salidas
      if (mv != null && (kind === "diff" ? layers.a[k] < mv && layers.b[k] < mv : v < mv)) continue;
      // por encima del máximo (p. ej. visibilidad > 20 km) tampoco; en la diferencia, solo si lo está en las dos salidas
      if (xv != null && (kind === "diff" ? layers.a[k] > xv && layers.b[k] > xv : v > xv)) continue;
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
function getCrop(g, regionId = state.region) {
  const reg = REGIONS[regionId];
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

// ---------- Filtros de terreno: altitud y superficie (tierra / mar) ----------
function elevText() {
  const { min, max } = state.elev, a = Number.isFinite(min), b = Number.isFinite(max), parts = [];
  if (state.surface !== "all") parts.push(state.surface === "land" ? "tierra" : "mar");
  if (a || b) parts.push(a && b ? `terreno ${min}–${max} m` : a ? `terreno ≥ ${min} m` : `terreno < ${max} m`);
  return parts.length ? parts.join(" · ") : null;
}
// Máscara 0/1 por celda: altura del terreno en [min, max) y/o solo tierra / solo mar. Null si no hay ningún filtro activo.
// Un filtro cuyos datos aún no se han cargado se ignora (se rehace al terminar la carga).
function rebuildCellMask() {
  const { min, max } = state.elev, surf = state.surface;
  const useElev = !!state.orog && (Number.isFinite(min) || Number.isFinite(max));
  const useSurf = !!state.land && surf !== "all";
  if (!useElev && !useSurf) { state.cellMask = null; return; }
  const lo = Number.isFinite(min) ? min : -Infinity, hi = Number.isFinite(max) ? max : Infinity;
  const m = new Uint8Array((state.orog ?? state.land).length);
  for (let k = 0; k < m.length; k++) {
    let ok = true;
    if (useElev) { const h = state.orog[k]; ok = h >= lo && h < hi; }
    if (ok && useSurf) ok = (state.land[k] >= 0.5) === (surf === "land");
    m[k] = ok ? 1 : 0;
  }
  state.cellMask = m;
}

// La costa se carga antes de dibujar nada, para que drawPanel sea síncrono (sin carreras al redimensionar).
const coast = await (await fetch("coast.json")).json();
const ukRings = await (await fetch("uk.json")).json(); // contorno del Reino Unido (scripts/build-uk.mjs) para el ámbito «Solo Reino Unido»

function drawAll() {
  for (const p of panels) withCtx(p.ctx, () => drawPanel(p));
  renderActive();
}

// ---------- Resumen de lo activo ----------
// Etiquetas con los ajustes que no están por defecto (visibles aunque el panel esté plegado): cada una se quita con un clic,
// y «Restablecer» quita todas. Los números de las secciones del panel cuentan las etiquetas de cada una.
let activeList = [];
const SEC_TITLES = { datos: "Datos", vista: "Vista", filtros: "Filtros" };
function describeFilter(w) {
  const f = filterOf(w), cfg = cfgOf(w), u = cfg.viewUnit ?? cfg.unit;
  if (f.op === "lt" && Number.isFinite(f.v1)) return `< ${num(f.v1)} ${u}`;
  if (f.op === "gt" && Number.isFinite(f.v1)) return `> ${num(f.v1)} ${u}`;
  if (f.op === "between" && Number.isFinite(f.v1) && Number.isFinite(f.v2)) return `${num(Math.min(f.v1, f.v2))}–${num(Math.max(f.v1, f.v2))} ${u}`;
  return null;
}
function activeItems() {
  const it = [], add = (sec, text, reset) => it.push({ sec, text, reset });
  const fire = (id, value) => { const el = $(id); el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); };
  const optText = id => $(id).selectedOptions[0].textContent.toLowerCase();
  if ($("frames").value !== "1") add("datos", `fotogramas: ${optText("frames")}`, () => fire("frames", "1"));
  if (needsB() && $("offset").value !== "12") add("datos", `comparar con: ${optText("offset")}`, () => fire("offset", "12"));
  if (!state.dual && (state.shown.b || state.shown.diff)) {
    const names = ["última salida", state.shown.b && "salida anterior", state.shown.diff && "diferencia"].filter(Boolean);
    add("vista", `mapas: ${names.join(" + ")}`, () => { for (const k of ["b", "diff"]) if (state.shown[k]) document.querySelector(`#panels button[data-k="${k}"]`).click(); });
  }
  if (state.region !== DEFAULT_REGION) add("vista", `zona: ${REGIONS[state.region].label}`, () => fire("region", DEFAULT_REGION));
  if (state.contours) add("vista", state.ovKey === "same" ? "isolíneas" : `isolíneas de ${VARIABLES[state.ovKey].label.toLowerCase()}`, () => document.querySelector('#contoursw button[data-c="0"]').click());
  if (state.marks !== "none") add("vista", `valores: ${optText("marks")}`, () => fire("marks", "none"));
  if (state.scope !== "view") add("vista", `ámbito: ${SCOPES[state.scope].toLowerCase()}`, () => fire("scope", "view"));
  for (const w of state.dual ? [0, 1] : [0]) {
    const t = describeFilter(w);
    if (t) add("filtros", `${state.dual ? `mapa ${w + 1}: ` : ""}valor ${t}`, () => { setFilterOf(w, { op: "none", v1: NaN, v2: NaN }); syncFilterUI(w); applyFilter(); });
  }
  if (state.surface !== "all") add("filtros", state.surface === "land" ? "solo tierra" : "solo mar", () => { state.surface = "all"; applyElev(); });
  const { min, max } = state.elev, a = Number.isFinite(min), b = Number.isFinite(max);
  if (a || b) add("filtros", a && b ? `terreno ${min}–${max} m` : a ? `terreno ≥ ${min} m` : `terreno < ${max} m`, () => { state.elev = { min: NaN, max: NaN }; applyElev(); });
  return it;
}
function renderActive() {
  activeList = activeItems();
  const box = $("active");
  box.hidden = activeList.length === 0;
  box.innerHTML = activeList.length
    ? `<span>Activo:</span>` + activeList.map((x, i) => `<button class="chip" data-i="${i}" title="Quitar este ajuste">${x.text}</button>`).join("") +
      (activeList.length > 1 ? `<button class="reset" data-reset>Restablecer todo</button>` : "")
    : "";
  for (const d of document.querySelectorAll("#controls details.sec")) {
    const n = activeList.filter(x => x.sec === d.dataset.sec).length, badge = d.querySelector(".badge");
    badge.hidden = n === 0; badge.textContent = n;
    badge.title = n ? `${n} ajuste${n > 1 ? "s" : ""} activo${n > 1 ? "s" : ""} en ${SEC_TITLES[d.dataset.sec]}` : "";
  }
}

function drawPanel(p) {
  const L = state.layers;
  if (!L || (p.kind !== "a" && !L.b)) return; // la salida anterior aún se está descargando
  const img = getImage(p.kind), crop = getCrop(L.grid), cfg = state.cfg;
  const cssW = p.canvas.clientWidth || 320, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(cssW * dpr), H = Math.round(W * crop.sh / crop.sw);
  p.canvas.style.aspectRatio = `${crop.sw} / ${crop.sh}`;
  $("maps").style.setProperty("--ar", crop.sw / crop.sh); // el CSS limita el ancho para que el mapa no pase de --mapH de alto
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
  const cs = contourSource(), contourNote = state.contours && cs ? drawContours(ctx, p, crop, f, dpr, ink, ring, cs) : null;
  const marksNote = state.marks === "highlow" ? drawHighLow(ctx, p, crop, f, dpr, ink, ring)
    : state.marks !== "none" ? drawMarks(ctx, p, crop, f, dpr, cssW, ink, ring) : null;
  for (const [lon, lat] of CITIES) {
    const [x, y] = to(lon, lat);
    if (x < 0 || y < 0 || x > W || y > H) continue;
    ctx.beginPath(); ctx.arc(x, y, 5.5 * dpr, 0, 7); ctx.fillStyle = ring; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 3.5 * dpr, 0, 7); ctx.fillStyle = `rgb(${ink})`; ctx.fill();
  }

  // Título y leyenda
  const meta = state.meta[p.kind] ?? { run: "", fc: "" };
  const ft = filterText(), et = elevText();
  const flt = [ft && `${p.kind === "diff" ? "valor en alguna salida" : "valor"} ${ft}`, et].filter(Boolean).join(" · ");
  // línea 1: salida (o "última − anterior"); línea 2: alcance y fecha del pronóstico; línea 3 (reservada): filtros
  p.caption.innerHTML = `<b>${state.dual ? cfg.label : panelName(p.kind)}</b> <span>· ${meta.run}</span><span class="fc">${meta.fc || "&nbsp;"}</span>` +
    // línea reservada aunque no haya filtro: así activarlo o quitarlo no desplaza los mapas
    `<span class="flt">${flt ? `solo: ${flt}` : ""}</span>`;
  drawLegend(p, cfg, L, img);
  for (const t of [contourNote, marksNote]) if (t) { const n = document.createElement("span"); n.className = "note"; n.textContent = t; p.legend.append(n); }
}

// De dónde salen las isolíneas: de otra variable (state.ov) o de la propia del mapa; null si no tiene equidistancia definida.
function contourSource() {
  if (state.ov && overlayCfg()) return state.ov.cfg.contour ? { cfg: state.ov.cfg, layers: state.ov.layers, cache: state.ov.contourCache, overlay: true } : null;
  return state.cfg.contour ? { cfg: state.cfg, layers: state.layers, cache: state.contourCache, overlay: false } : null;
}

// Isolíneas del campo de la salida mostrada (en la diferencia, las de la última salida). Se calculan una vez por campo
// (suavizadas y a resolución de malla) y al dibujar solo se filtran por zona, altitud/superficie y valor.
function contourData(src, cs) {
  const { cfg, layers: L, cache } = cs;
  if (cache[src]) return cache[src];
  const g = L.grid, { step } = cfg.contour;
  const lo = Math.max(cfg.range[0], cfg.minValue ?? -Infinity), hi = Math.min(cfg.range[1], cfg.maxValue ?? Infinity);
  const levels = contourLevels(lo, hi, step);
  let data = L[src] ?? L.a;
  if (!cfg.static) for (let n = 0; n < (cfg.contour.smooth ?? 1); n++) data = smoothField(data, g.nx, g.ny);
  return (cache[src] = { levels, segs: buildContours(data, g.nx, g.ny, levels, cfg.contour.minSegs), vals: L[src] ?? L.a });
}

function drawContours(ctx, p, crop, f, dpr, ink, ring, cs) {
  const L = state.layers, g = L.grid, { cfg, overlay } = cs, { step, major } = cfg.contour;
  const src = p.kind === "b" ? "b" : "a", cd = contourData(src, cs);
  const m = filterMatcher(), em = state.cellMask;
  // el filtro de valores es el del mapa: las isolíneas (también las de otra variable) solo donde el mapa se pinta por el filtro
  const mine = p.kind === "b" ? L.b : L.a, other = p.kind === "diff" ? L.b : null;
  const ok = k => (!em || em[k] === 1) && (!m || m(mine[k]) || (other && m(other[k])));
  const X = i => (i + 0.5 - crop.sx) * f, Y = j => (g.ny - 1 - j + 0.5 - crop.sy) * f;
  const W = crop.sw * f, H = crop.sh * f, vd = cfg.viewDecimals ?? cfg.decimals, labels = [], majors = [];
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const [lev, a] of cd.segs) {
    const isMajor = Math.abs(Math.round(lev / step) % major) === 0;
    const path = new Path2D();
    for (let q = 0; q < a.length; q += 5) {
      if (!ok(a[q + 4])) continue;
      const x1 = X(a[q]), y1 = Y(a[q + 1]), x2 = X(a[q + 2]), y2 = Y(a[q + 3]);
      if ((x1 < 0 && x2 < 0) || (y1 < 0 && y2 < 0) || (x1 > W && x2 > W) || (y1 > H && y2 > H)) continue;
      path.moveTo(x1, y1); path.lineTo(x2, y2);
      if (isMajor && x1 > 24 * dpr && x1 < W - 24 * dpr && y1 > 12 * dpr && y1 < H - 12 * dpr) majors.push([lev, (x1 + x2) / 2, (y1 + y2) / 2]);
    }
    ctx.strokeStyle = ring; ctx.globalAlpha = 0.45; ctx.lineWidth = (isMajor ? 3.4 : 2.4) * dpr; ctx.stroke(path);
    ctx.globalAlpha = 0.9; ctx.strokeStyle = `rgb(${ink})`; ctx.lineWidth = (isMajor ? 1.8 : 0.9) * dpr; ctx.stroke(path);
  }
  ctx.globalAlpha = 1;
  // etiquetas de las líneas principales: separadas al menos ~150 px de pantalla entre sí
  const gap = 150 * dpr;
  ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let q = 0; q < majors.length; q++) {
    const [lev, x, y] = majors[q];
    if (labels.some(l => Math.hypot(l[0] - x, l[1] - y) < gap)) continue;
    labels.push([x, y]);
    const txt = String(Number(lev.toFixed(vd)));
    ctx.lineWidth = 3.2 * dpr; ctx.strokeStyle = ring; ctx.strokeText(txt, x, y);
    ctx.fillStyle = `rgb(${ink})`; ctx.fillText(txt, x, y);
  }
  return `Isolíneas${overlay ? ` de ${cfg.label}` : ""} cada ${step} ${cfg.viewUnit ?? cfg.unit}${p.kind === "diff" ? " (de la última salida)" : ""}`;
}

// ---------- Ámbito (estadísticas y marcas) ----------
const SCOPES = { view: "Zona visible", uk: "Reino Unido e Irlanda", ukonly: "Solo Reino Unido (fronteras)", grid: "Dominio completo del modelo" };
const scopeLabel = () => state.scope === "view" ? `zona visible (${REGIONS[state.region].label})` : SCOPES[state.scope];
// Máscara 0/1 de las celdas del ámbito (null = todo el dominio) y su nº de celdas.
// El contorno del Reino Unido se rasteriza sobre la malla (un lienzo del tamaño de la malla): una celda es del UK si el contorno cubre más de la mitad.
function ukOutlineMask(g) {
  const cv = document.createElement("canvas"); cv.width = g.nx; cv.height = g.ny;
  const ctx = cv.getContext("2d", { willReadFrequently: true }), path = new Path2D();
  for (const ring of ukRings) {
    ring.forEach(([lon, lat], k) => { const [x, y] = toImagePx(g, lon, lat); k ? path.lineTo(x, y) : path.moveTo(x, y); });
    path.closePath();
  }
  ctx.fillStyle = "#000"; ctx.fill(path);
  const px = ctx.getImageData(0, 0, g.nx, g.ny).data, mask = new Uint8Array(g.nx * g.ny);
  let count = 0;
  for (let r = 0; r < g.ny; r++) for (let i = 0; i < g.nx; i++) {
    if (px[(r * g.nx + i) * 4 + 3] >= 128) { mask[(g.ny - 1 - r) * g.nx + i] = 1; count++; }
  }
  return { mask, count };
}

function scopeMask() {
  const g = state.layers.grid, regionId = state.scope === "view" ? state.region : state.scope === "uk" ? "uk" : "grid";
  const key = (state.scope === "ukonly" ? "ukonly" : regionId) + "|" + g.nx;
  if (state.scopeMaskCache?.key === key) return state.scopeMaskCache;
  if (state.scope === "ukonly") return (state.scopeMaskCache = { key, ...ukOutlineMask(g) });
  let mask = null, count = g.nx * g.ny;
  if (REGIONS[regionId].box) {
    const c = getCrop(g, regionId);
    mask = new Uint8Array(g.nx * g.ny); count = 0;
    for (let j = 0; j < g.ny; j++) {
      const y = g.ny - 1 - j + 0.5;
      if (y < c.sy || y >= c.sy + c.sh) continue;
      for (let i = 0; i < g.nx; i++) { const x = i + 0.5; if (x >= c.sx && x < c.sx + c.sw) { mask[j * g.nx + i] = 1; count++; } }
    }
  }
  return (state.scopeMaskCache = { key, mask, count });
}
const inverseLaea = makeLaeaInverse();
function cellLonLat(g, k) {
  const [lon, lat] = inverseLaea(g.x0 + (k % g.nx) * g.dx, g.y0 + Math.floor(k / g.nx) * g.dy);
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "O"}`;
}

// ¿Se pinta (y cuenta para las marcas) la celda k del mapa `kind`? Misma regla que el dibujo, más el ámbito.
function markOk(kind, L, cfg, sc, m, em) {
  const vals = kind === "a" ? L.a : kind === "b" ? L.b : L.diff, mv = cfg.minValue ?? null, xv = cfg.maxValue ?? null;
  return k => {
    const v = vals[k];
    if (!Number.isFinite(v) || (sc && !sc[k]) || (em && !em[k])) return false;
    if (kind === "diff") {
      if (mv != null && L.a[k] < mv && L.b[k] < mv) return false;
      if (xv != null && L.a[k] > xv && L.b[k] > xv) return false;
      return !m || m(L.a[k]) || m(L.b[k]);
    }
    if ((mv != null && v < mv) || (xv != null && v > xv)) return false;
    return !m || m(v);
  };
}

// Los n mayores (dir 1) o menores (dir −1) valores, separados al menos `R` celdas entre sí.
function findPeaks(vals, ok, g, n, dir, R) {
  const cand = [];
  for (let k = 0; k < vals.length; k++) if (ok(k)) cand.push(k);
  const ex = new Uint8Array(vals.length), out = [];
  for (let q = 0; q < n; q++) {
    let best = -1, bv = -Infinity;
    for (const k of cand) { if (!ex[k] && vals[k] * dir > bv) { bv = vals[k] * dir; best = k; } }
    if (best < 0) break;
    out.push({ k: best, v: vals[best], dir });
    const bi = best % g.nx, bj = Math.floor(best / g.nx);
    for (let j = Math.max(0, bj - R); j <= Math.min(g.ny - 1, bj + R); j++) for (let i = Math.max(0, bi - R); i <= Math.min(g.nx - 1, bi + R); i++) ex[j * g.nx + i] = 1;
  }
  return out;
}

// Marcas de valores sobre el mapa: máximo y mínimo, picos del filtro o rejilla de números.
function drawMarks(ctx, p, crop, f, dpr, cssW, ink, ring) {
  const L = state.layers, g = L.grid, cfg = state.cfg, kind = p.kind;
  const vals = kind === "a" ? L.a : kind === "b" ? L.b : L.diff;
  const m = filterMatcher(), em = state.cellMask, { mask: sc } = scopeMask(), ok = markOk(kind, L, cfg, sc, m, em);
  const X = i => (i + 0.5 - crop.sx) * f, Y = j => (g.ny - 1 - j + 0.5 - crop.sy) * f, W = crop.sw * f, H = crop.sh * f;
  const vd = kind === "diff" ? cfg.decimals + 1 : (cfg.viewDecimals ?? cfg.decimals), unit = kind === "diff" ? cfg.unit : (cfg.viewUnit ?? cfg.unit);
  const fmt = v => kind === "diff" ? signed(v, vd) : fixed(v, vd);
  ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  const text = (t, x, y, align, size = 11) => {
    ctx.font = `600 ${size * dpr}px system-ui, sans-serif`; ctx.textAlign = align;
    ctx.lineWidth = 3.2 * dpr; ctx.strokeStyle = ring; ctx.strokeText(t, x, y);
    ctx.fillStyle = `rgb(${ink})`; ctx.fillText(t, x, y);
  };
  if (state.marks === "grid") {
    const step = Math.max(1, Math.round((kind === "diff" ? 60 : 46) / (cssW / crop.sw))); // la diferencia lleva signo y un decimal más: más espacio
    let drawn = 0;
    for (let r = Math.ceil(crop.sy / step) * step; r < crop.sy + crop.sh && drawn < 2500; r += step) {
      for (let i = Math.ceil(crop.sx / step) * step; i < crop.sx + crop.sw; i += step) {
        const j = g.ny - 1 - r, k = j * g.nx + i;
        if (j < 0 || i >= g.nx || !ok(k)) continue;
        text(fmt(vals[k]), X(i), Y(j), "center", 10); drawn++;
      }
    }
    return `Valores de la malla cada ~${Math.round(step * 2)} km`;
  }
  // máximo y mínimo (1 de cada) o picos (8 con el filtro «mayor que» / «menor que», 5 de cada con otro): se calculan una vez
  const ft = state.filter.op, extremes = state.marks === "extremes";
  const key = [kind, state.marks, state.scope, state.scope === "view" ? state.region : "", filterText(), elevText(), state.surface].join("|");
  if (!state.marksCache[key]) {
    const n = extremes ? 1 : ft === "gt" || ft === "lt" ? 8 : 5, R = extremes ? 0 : 25, peaks = [];
    if (extremes || ft !== "lt") peaks.push(...findPeaks(vals, ok, g, n, 1, R));
    if (extremes || ft !== "gt") peaks.push(...findPeaks(vals, ok, g, n, -1, R));
    state.marksCache[key] = peaks;
  }
  for (const pk of state.marksCache[key]) {
    const x = X(pk.k % g.nx), y = Y(Math.floor(pk.k / g.nx));
    if (x < 0 || y < 0 || x > W || y > H) continue;
    ctx.beginPath(); ctx.arc(x, y, 6 * dpr, 0, 7); ctx.fillStyle = ring; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 4 * dpr, 0, 7); ctx.fillStyle = pk.dir > 0 ? "#d7301f" : "#2166ac"; ctx.fill();
    const right = x < W - 70 * dpr;
    text(`${pk.dir > 0 ? "▲" : "▼"} ${fmt(pk.v)}${extremes ? " " + unit : ""}`, x + (right ? 9 : -9) * dpr, y - 9 * dpr, right ? "left" : "right");
  }
  return extremes ? `Máximo y mínimo del ámbito: ${scopeLabel()}` : `Picos separados ≥ 50 km (ámbito: ${scopeLabel()})`;
}

// ---------- Altas y bajas de presión ----------
// Extremos locales de la presión a nivel del mar: el campo se suaviza y un punto es una alta (baja) si es el máximo (mínimo) de su
// entorno de ~180 km y lo supera en al menos 2 hPa; entre dos extremos del mismo tipo más cerca que ese radio se queda el más fuerte.
function findHighLow(vals, g) {
  let data = vals;
  for (let n = 0; n < 4; n++) data = smoothField(data, g.nx, g.ny);
  const step = 6, R = 90, Rc = R / step, edge = 30, minAmp = 2; // en celdas de 2 km; minAmp en hPa
  const ncx = Math.floor((g.nx - 2 * edge) / step), ncy = Math.floor((g.ny - 2 * edge) / step), C = new Float32Array(ncx * ncy);
  for (let cj = 0; cj < ncy; cj++) for (let ci = 0; ci < ncx; ci++) C[cj * ncx + ci] = data[(edge + cj * step) * g.nx + edge + ci * step];
  const found = [];
  for (let cj = 0; cj < ncy; cj++) {
    for (let ci = 0; ci < ncx; ci++) {
      const v = C[cj * ncx + ci];
      if (!Number.isFinite(v)) continue;
      let isMax = true, isMin = true, lo = Infinity, hi = -Infinity;
      for (let dj = Math.max(0, cj - Rc); dj <= Math.min(ncy - 1, cj + Rc) && (isMax || isMin); dj++) {
        for (let di = Math.max(0, ci - Rc); di <= Math.min(ncx - 1, ci + Rc); di++) {
          if ((di - ci) ** 2 + (dj - cj) ** 2 > Rc * Rc) continue;
          const w = C[dj * ncx + di];
          if (!Number.isFinite(w)) continue;
          if (w > v) isMax = false;
          if (w < v) isMin = false;
          if (w < lo) lo = w;
          if (w > hi) hi = w;
        }
      }
      if (isMax && v - lo >= minAmp) found.push({ i: edge + ci * step, j: edge + cj * step, v, high: true });
      else if (isMin && hi - v >= minAmp) found.push({ i: edge + ci * step, j: edge + cj * step, v, high: false });
    }
  }
  found.sort((a, b) => (b.high ? b.v : -b.v) - (a.high ? a.v : -a.v));
  const out = [];
  for (const f of found) if (!out.some(o => o.high === f.high && Math.hypot(o.i - f.i, o.j - f.j) < R)) out.push(f);
  return out;
}

// Dibuja una «A» (alta) o una «B» (baja) con la presión en hPa en cada extremo de la zona visible.
function drawHighLow(ctx, p, crop, f, dpr, ink, ring) {
  const pm = state.pm;
  if (!pm) return null;
  const src = p.kind === "b" ? "b" : "a", g = pm.layers.grid;
  pm.cache[src] ??= findHighLow(pm.layers[src] ?? pm.layers.a, g);
  const vals = pm.layers[src] ?? pm.layers.a, vd = pm.cfg.decimals;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  const W = crop.sw * f, H = crop.sh * f;
  for (const e of pm.cache[src]) {
    const x = (e.i + 0.5 - crop.sx) * f, y = (g.ny - 1 - e.j + 0.5 - crop.sy) * f;
    if (x < 10 * dpr || y < 14 * dpr || x > W - 10 * dpr || y > H - 20 * dpr) continue;
    const color = e.high ? "#d7301f" : "#2166ac";
    ctx.font = `800 ${24 * dpr}px system-ui, sans-serif`; ctx.lineWidth = 4 * dpr; ctx.strokeStyle = ring; ctx.strokeText(e.high ? "A" : "B", x, y);
    ctx.fillStyle = color; ctx.fillText(e.high ? "A" : "B", x, y);
    ctx.font = `600 ${11 * dpr}px system-ui, sans-serif`; ctx.lineWidth = 3.2 * dpr; ctx.strokeStyle = ring; ctx.strokeText(vals[e.j * g.nx + e.i].toFixed(0), x, y + 17 * dpr);
    ctx.fillStyle = `rgb(${ink})`; ctx.fillText(vals[e.j * g.nx + e.i].toFixed(0), x, y + 17 * dpr);
  }
  return `A / B: altas y bajas de presión (extremos locales del campo suavizado, ≥ 2 hPa sobre su entorno de ~180 km), en ${pm.cfg.unit}`;
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
  const path = new Path2D(), m = filterMatcher(), vf = state.cfg.viewFactor ?? 1, em = state.cellMask;
  for (const a of state.arrowCache.get(key)) {
    if (m && !m(a.s * vf)) continue;
    if (state.cfg.minValue != null && a.s * vf < state.cfg.minValue) continue;
    if (em && !em[Math.round(g.ny - a.py - 0.5) * g.nx + Math.round(a.px - 0.5)]) continue; // altitud de la celda de la flecha
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
  right.className = "r";
  lg.append(bar, left, right);
  if (cfg.minValue != null || cfg.maxValue != null) { // aviso de lo que no se pinta
    const note = document.createElement("span");
    note.className = "note";
    const what = [cfg.minValue != null ? `< ${num(cfg.minValue)}` : null, cfg.maxValue != null ? `> ${num(cfg.maxValue)}` : null].filter(Boolean).join(" ni ");
    note.textContent = `Sin pintar: valores ${what} ${vu}${p.kind === "diff" ? " (en la diferencia, solo donde ambas salidas están fuera del rango)" : ""}`;
    lg.append(note);
  }
}

function drawArrowKey() {
  const el = $("arrowkey");
  const html = [null, ...(state.dual ? [state.sec] : [])].map(ctx => withCtx(ctx, arrowKeyHtml)).find(Boolean) ?? "";
  el.innerHTML = html;
}
function arrowKeyHtml() {
  const L = state.layers;
  if (!L?.wind) return "";
  const st = arrowStyle(), sw = c => `<b style="background:${c}"></b>`;
  const parts = [
    state.shown.a || state.shown.diff ? `${sw(st.A)} ${NAME.a}` : null,
    L.b && (state.shown.b || state.shown.diff) ? `${sw(st.B)} ${NAME.b}` : null,
  ].filter(Boolean).join(" · ");
  const both = state.shown.diff ? " (en la diferencia se muestran ambas)" : "";
  return `Flechas: ${parts}${both} — hacia donde sopla; longitud ∝ velocidad (máx. ${Math.round(ARROWS.vref * (state.cfg.viewFactor ?? 1))} ${state.cfg.viewUnit ?? "m/s"})`;
}

// `ok(k)` / `okv(k, v)`: ¿la celda k cumple el filtro de altitud y el de valores? `filtered`: hay algún filtro activo.
function diffTiles(cfg, layers, ok, filtered, scopeCount) {
  const diff = layers.diff, g = layers.grid, area = c => `${(c * 4).toLocaleString("es-ES")} km²`;
  let pass = 0, n = 0, sum = 0, sq = 0, ab = 0, mx = -Infinity, mn = Infinity, gt = 0, kmx = -1, kmn = -1;
  for (let k = 0; k < diff.length; k++) {
    if (!ok(k)) continue;
    pass++;
    const d = diff[k];
    if (!Number.isFinite(d)) continue;
    n++; sum += d; sq += d * d; ab += Math.abs(d);
    if (d > mx) { mx = d; kmx = k; } if (d < mn) { mn = d; kmn = k; } if (Math.abs(d) > cfg.thresh) gt++;
  }
  const dec = cfg.decimals + 1, u = ` ${cfg.unit}`;
  const sg = v => signed(v, dec), pc = (x, t) => t ? `${(100 * x / t).toFixed(1)} %` : "—";
  let tiles;
  if (n === 0) tiles = [["Diferencia", "sin celdas"]];
  else if (layers.kind === "vector") {
    tiles = [
      ["Módulo medio de la diferencia", (sum / n).toFixed(dec) + u],
      ["Error cuadrático medio", Math.sqrt(sq / n).toFixed(dec) + u],
      ["Máximo", mx.toFixed(dec) + u + where(g, kmx)],
      [`Celdas con diferencia > ${cfg.thresh}${u}`, pc(gt, n)],
    ];
  } else {
    tiles = [
      ["Diferencia media", sg(sum / n) + u],
      ["Diferencia absoluta media", (ab / n).toFixed(dec) + u],
      ["Error cuadrático medio", Math.sqrt(sq / n).toFixed(dec) + u],
      [`Última ${cfg.pos} (máx.)`, sg(mx) + u + where(g, kmx)],
      [`Última ${cfg.neg} (máx.)`, sg(mn) + u + where(g, kmn)],
      [`Celdas con |Δ| > ${cfg.thresh}${u}`, pc(gt, n)],
    ];
    if (layers.kind === "wdiff") {
      // los extremos de una diferencia circular (±180°) no informan: se sustituyen por la cobertura de la máscara
      tiles.splice(3, 2);
      tiles.push([`Celdas con viento ≥ ${Math.round(cfg.minSpeed * cfg.viewFactor)} ${cfg.viewUnit} en ambas salidas`, pc(n, pass)]);
    }
  }
  if (filtered) tiles.push(["Celdas que cumplen los filtros", `${pc(pass, scopeCount)} <small>≈ ${area(pass)}</small>`]);
  return tiles;
}

const where = (g, k) => k >= 0 ? ` <small>${cellLonLat(g, k)}</small>` : "";

// Mínimo, media y máximo de los datos de cada mapa en bruto mostrado (solo de las celdas que cumplen los filtros).
function rawTiles(cfg, layers, arr, name, okv, filtered, sc) {
  const mv = cfg.minValue ?? null, xv = cfg.maxValue ?? null, g = layers.grid;
  let n = 0, total = 0, sum = 0, mn = Infinity, mx = -Infinity, above = 0, finite = 0, kmn = -1, kmx = -1;
  for (let k = 0; k < arr.length; k++) {
    const v = arr[k];
    if (!Number.isFinite(v) || (sc && !sc[k])) continue;
    finite++;
    if (mv != null && v < mv) continue; // por debajo del mínimo: ni pintado ni contado
    above++;
    total++;
    if (!okv(k, v)) continue;
    n++; sum += v; if (v < mn) { mn = v; kmn = k; } if (v > mx) { mx = v; kmx = k; }
  }
  const vd = cfg.viewDecimals ?? cfg.decimals, vu = ` ${cfg.viewUnit ?? cfg.unit}`, w = layers.wind ? " · velocidad" : "";
  const tiles = n === 0
    ? [[`${name}${w}`, "sin celdas"]]
    : [[`${name}${w} · mínimo`, fixed(mn, vd) + vu + where(g, kmn)], [`${name}${w} · media`, fixed(sum / n, vd) + vu], [`${name}${w} · máximo`, fixed(mx, vd) + vu + where(g, kmx)]];
  if (mv != null) tiles.push([`${name} · celdas con ≥ ${num(mv)} ${vu.trim()}`, `${(100 * above / finite).toFixed(1)} %`]);
  if (filtered) tiles.push([`${name} · celdas que cumplen los filtros`, `${(100 * n / total).toFixed(1)} % <small>≈ ${(n * 4).toLocaleString("es-ES")} km²</small>`]);
  return tiles;
}

function statsTiles(cfg, layers) {
  const m = filterMatcher(), em = state.cellMask, filtered = !!(m || em), tiles = [];
  const { mask: sc, count } = scopeMask(); // las estadísticas cuentan solo las celdas del ámbito
  const okv = (k, v) => (!em || em[k] === 1) && (!m || m(v)); // el mínimo (minValue) lo aplica rawTiles
  const mv = cfg.minValue ?? null;
  const okd = k => (!sc || sc[k]) && (!em || em[k] === 1) && (mv == null || layers.a[k] >= mv || layers.b[k] >= mv) && (!m || m(layers.a[k]) || m(layers.b[k]));
  if (state.shown.a) tiles.push(...rawTiles(cfg, layers, layers.a, panelName("a"), okv, filtered, sc));
  if (state.shown.b && layers.b) tiles.push(...rawTiles(cfg, layers, layers.b, panelName("b"), okv, filtered, sc));
  if (state.shown.diff && layers.diff) tiles.push(...diffTiles(cfg, layers, okd, filtered, count));
  return tiles.map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join("");
}

function drawStats(cfg, layers) {
  const { count } = scopeMask();
  const body = state.dual && state.sec.layers
    ? [null, state.sec].map(ctx => withCtx(ctx, () => `<div class="scope"><b>${state.cfg.label}</b></div>` + statsTiles(state.cfg, state.layers))).join("")
    : statsTiles(cfg, layers);
  $("stats").innerHTML = `<div class="scope">Estadísticas del ámbito: <b>${scopeLabel()}</b> · ≈ ${(count * 4).toLocaleString("es-ES")} km²</div>` + body;
}

// ---------- Tooltip ----------
const tip = $("tip");
const muted = t => `<span style="color:var(--muted)">${t}</span>`;
// Texto del valor de la celda k en el mapa `kind` de la variable activa (en el contexto actual de `state`).
function valueHtml(kind, k) {
  const { cfg, layers } = state;
  const dec = cfg.decimals, vd = cfg.viewDecimals ?? cfg.decimals, vu = cfg.viewUnit ?? cfg.unit;
  if (kind !== "diff") {
    // Mapa en bruto: valor absoluto de esa salida (en el viento, velocidad y dirección).
    const arr = kind === "a" ? layers.a : layers.b, dirs = kind === "a" ? layers.dirA : layers.dirB;
    return layers.kind === "scalar"
      ? `${muted(state.dual ? cfg.label : panelName(kind))}<br><b>${arr[k].toFixed(dec)}</b> ${cfg.unit}`
      : `${muted(`${state.dual ? cfg.label : panelName(kind)} · velocidad y dirección`)}<br><b>${arr[k].toFixed(vd)}</b> ${vu} · <b>${Math.round(dirs[k])}°</b>`;
  }
  const d = layers.diff[k];
  const dtxt = Number.isFinite(d) ? `${signed(d, dec)} ${cfg.unit}` : "sin dato (viento flojo)";
  if (layers.kind === "scalar") return `Δ <b>${dtxt}</b><br>Última <b>${layers.a[k].toFixed(dec)}</b> · Anterior <b>${layers.b[k].toFixed(dec)}</b> ${cfg.unit}`;
  const line = (n, sp, dir) => `${n} <b>${sp.toFixed(vd)}</b> ${vu} · <b>${Math.round(dir)}°</b>`;
  return `${layers.kind === "vector" ? "|Δ vector|" : "Δ dirección"} <b>${dtxt}</b><br>${line("Última", layers.a[k], layers.dirA[k])}<br>${line("Anterior", layers.b[k], layers.dirB[k])}`;
}

function onMove(e, canvas, kind) {
  const { cfg, layers } = state;
  if (!layers || (!state.dual && kind !== "a" && !layers.b) || (state.dual && !state.sec.layers)) return;
  const g = layers.grid, crop = getCrop(g), r = canvas.getBoundingClientRect();
  const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
  const px = crop.sx + fx * crop.sw, py = crop.sy + fy * crop.sh;
  const i = Math.floor(px), j = g.ny - 1 - Math.floor(py);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) { tip.style.display = "none"; return; }
  const k = j * g.nx + i;
  // dos variables: el valor de las dos en la celda, y una cruz en el mismo punto de los dos mapas
  let html = state.dual
    ? [null, state.sec].map(ctx => withCtx(ctx, () => valueHtml("a", k))).join("<br>")
    : valueHtml(kind, k);
  if (state.dual) for (const q of panels) {
    q.xh.hidden = false;
    q.xh.style.left = `${q.canvas.offsetLeft + fx * q.canvas.clientWidth}px`;
    q.xh.style.top = `${q.canvas.offsetTop + fy * q.canvas.clientHeight}px`;
  }
  if (state.ov && overlayCfg()) { // valor de la variable de las isolíneas en la celda
    const ov = state.ov, arr = ov.layers[kind === "b" ? "b" : "a"] ?? ov.layers.a;
    html += `<br>${muted(ov.cfg.label)} <b>${arr[k].toFixed(ov.cfg.viewDecimals ?? ov.cfg.decimals)}</b> ${ov.cfg.viewUnit ?? ov.cfg.unit}`;
  }
  if (state.orog && !(cfg.static && !state.dual)) {
    const sup = state.land ? ` · ${state.land[k] >= 0.5 ? "tierra" : "mar"}` : "";
    html += `<br>${muted(`Terreno ${Math.round(state.orog[k])} m${sup}`)}`;
  }
  tip.innerHTML = html;
  tip.style.display = "block";
  tip.style.left = Math.min(e.clientX + 14, innerWidth - 200) + "px";
  tip.style.top = e.clientY + 14 + "px";
}

// ---------- Interfaz del filtro ----------
// Dos juegos de controles: w = 0 (variable del mapa 1) y w = 1 (variable del mapa 2, solo en el modo de dos variables).
const FUI = [
  { op: "fop", v1: "fv1", v2: "fv2", unit: "funit", presets: "fpresets", variable: "variable" },
  { op: "fop2", v1: "fv1b", v2: "fv2b", unit: "funit2", presets: "fpresets2", variable: "variable2" },
];
const cfgOf = w => VARIABLES[$(FUI[w].variable).value];
const filterOf = w => w ? state.sec.filter : state.filter;
const setFilterOf = (w, f) => { if (w) state.sec.filter = f; else state.filter = f; };

// Refleja el filtro en los controles: unidad, paso, atajos de la variable y qué entradas están activas.
function syncFilterUI(w = 0) {
  const ids = FUI[w], cfg = cfgOf(w), f = filterOf(w), step = Math.pow(10, -cfg.decimals);
  $(ids.op).value = f.op;
  $(ids.unit).textContent = cfg.viewUnit ?? cfg.unit;
  for (const [id, v, on] of [[ids.v1, f.v1, f.op !== "none"], [ids.v2, f.v2, f.op === "between"]]) {
    const el = $(id);
    el.disabled = !on; el.step = step;
    el.value = on && Number.isFinite(v) ? v : "";
  }
  $(ids.presets).innerHTML = (cfg.filterPresets ?? []).map((pr, i) => {
    const on = f.op === pr.op && f.v1 === pr.v && (pr.op !== "between" || f.v2 === pr.v2);
    return `<button data-i="${i}" aria-pressed="${on}">${pr.label}</button>`;
  }).join("");
}

// Aplica el filtro: no hay que descargar nada, solo repintar mapas, flechas y estadísticas.
function applyFilter() {
  state.images = {}; state.marksCache = {}; state.sec.images = {}; state.sec.marksCache = {};
  if (!state.layers) return;
  drawAll();
  drawStats(state.cfg, state.layers);
}

function initFilter() {
  FUI.forEach((ids, w) => {
    let timer;
    $(ids.op).addEventListener("input", () => {
      const cfg = cfgOf(w), op = $(ids.op).value, f = filterOf(w);
      if (op !== "none" && !Number.isFinite(f.v1)) f.v1 = cfg.filterPresets?.[0]?.v ?? cfg.range[0]; // valor de partida
      if (op === "between" && !Number.isFinite(f.v2)) f.v2 = Math.max(f.v1 + 1, cfg.range[1]);
      f.op = op;
      syncFilterUI(w); applyFilter();
    });
    for (const id of [ids.v1, ids.v2]) {
      $(id).addEventListener("input", () => {
        const f = filterOf(w);
        f.v1 = $(ids.v1).valueAsNumber; f.v2 = $(ids.v2).valueAsNumber;
        clearTimeout(timer); timer = setTimeout(() => { applyFilter(); $(ids.presets).querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", "false")); }, 120);
      });
    }
    $(ids.presets).addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      const pr = cfgOf(w).filterPresets[Number(b.dataset.i)], f = filterOf(w);
      const same = f.op === pr.op && f.v1 === pr.v;
      setFilterOf(w, same ? { op: "none", v1: NaN, v2: NaN } : { op: pr.op, v1: pr.v, v2: pr.v2 ?? NaN }); // otro clic lo quita
      syncFilterUI(w); applyFilter();
    });
  });
}

// ---------- Interfaz del filtro de altitud ----------
const ELEV_STEP = 100, ELEV_MIN_MAX = 1500; // selectores cada 100 m
const ELEV_PRESETS = [
  { label: "< 100 m", min: NaN, max: 100 }, { label: "100–300 m", min: 100, max: 300 }, { label: "300–600 m", min: 300, max: 600 },
  { label: "> 600 m", min: 600, max: NaN }, { label: "> 900 m", min: 900, max: NaN },
];
const sameNum = (x, y) => (Number.isNaN(x) && Number.isNaN(y)) || x === y;

function fillElevSelects() {
  const steps = Array.from({ length: ELEV_MIN_MAX / ELEV_STEP + 1 }, (_, i) => i * ELEV_STEP);
  $("emin").innerHTML = `<option value="">Sin mínimo</option>` + steps.map(v => `<option value="${v}">Desde ${v} m</option>`).join("");
  $("emax").innerHTML = `<option value="">Sin máximo</option>` + steps.slice(1).map(v => `<option value="${v}">Hasta ${v} m</option>`).join("");
  $("epresets").innerHTML = ELEV_PRESETS.map((pr, i) => `<button data-i="${i}" aria-pressed="false">${pr.label}</button>`).join("");
}

function syncElevUI() {
  const { min, max } = state.elev, ready = !!state.orog;
  $("surf").value = state.surface; $("surf").disabled = !state.land;
  $("emin").value = Number.isFinite(min) ? String(min) : "";
  $("emax").value = Number.isFinite(max) ? String(max) : "";
  for (const id of ["emin", "emax"]) $(id).disabled = !ready;
  $("epresets").querySelectorAll("button").forEach((b, i) => {
    b.disabled = !ready;
    b.setAttribute("aria-pressed", sameNum(ELEV_PRESETS[i].min, min) && sameNum(ELEV_PRESETS[i].max, max));
  });
}

// Cambia el filtro de altitud o de superficie: no descarga nada, solo recalcula la máscara y repinta.
function applyElev() {
  rebuildCellMask(); syncElevUI(); applyFilter();
}

function initElev() {
  fillElevSelects(); syncElevUI();
  const read = () => {
    let min = $("emin").value === "" ? NaN : Number($("emin").value), max = $("emax").value === "" ? NaN : Number($("emax").value);
    if (Number.isFinite(min) && Number.isFinite(max) && max <= min) max = min + ELEV_STEP; // intervalo siempre válido
    state.elev = { min, max }; applyElev();
  };
  $("emin").addEventListener("input", read); $("emax").addEventListener("input", read);
  $("surf").addEventListener("input", () => { state.surface = $("surf").value; applyElev(); });
  $("epresets").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const pr = ELEV_PRESETS[Number(b.dataset.i)];
    state.elev = sameNum(pr.min, state.elev.min) && sameNum(pr.max, state.elev.max) ? { min: NaN, max: NaN } : { min: pr.min, max: pr.max }; // otro clic lo quita
    applyElev();
  });
}

// ---------- Disposición: panel lateral o superior, plegable ----------
function initLayout() {
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento: no se recuerda */ } },
  };
  const app = $("app");
  let layout = store.get("ukv.layout") === "top" ? "top" : "side", collapsed = store.get("ukv.collapsed") === "1";
  const apply = () => {
    app.className = layout + (collapsed ? " collapsed" : "");
    $("layoutsw").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.l === layout));
    $("toggleCtl").setAttribute("aria-expanded", !collapsed);
    $("toggleCtl").textContent = collapsed ? "☰ Mostrar ajustes" : "✕ Ocultar ajustes";
    store.set("ukv.layout", layout); store.set("ukv.collapsed", collapsed ? "1" : "0");
  };
  $("layoutsw").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { layout = b.dataset.l; apply(); } });
  $("toggleCtl").addEventListener("click", () => { collapsed = !collapsed; apply(); });
  apply(); // al cambiar el tamaño de #maps, el ResizeObserver repinta los mapas
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
  $("ovvar").innerHTML = `<option value="same">La misma variable del mapa</option>` + $("variable").innerHTML; // variable de las isolíneas
  $("variable2").innerHTML = $("variable").innerHTML; $("variable2").value = "cloud"; // segunda variable del modo de dos variables
  $("region").innerHTML = REGION_GROUPS.map(g =>
    `<optgroup label="${g.label}">${g.regions.map(r => `<option value="${r.id}">${r.label}</option>`).join("")}</optgroup>`).join("");
  $("region").value = DEFAULT_REGION;
  syncControls();
  refreshLeads(24);
  buildPanels();
  syncFilterUI(0); syncFilterUI(1); initFilter(); initElev();
  // Secciones plegables del panel: se recuerda cuáles están abiertas; el resumen de lo activo se quita con un clic
  for (const d of document.querySelectorAll("#controls details.sec")) {
    try { const v = localStorage.getItem("ukv.sec." + d.dataset.sec); if (v !== null) d.open = v === "1"; } catch { /* sin almacenamiento */ }
    d.addEventListener("toggle", () => { try { localStorage.setItem("ukv.sec." + d.dataset.sec, d.open ? "1" : "0"); } catch { /* idem */ } });
  }
  $("active").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.reset !== undefined) for (const x of activeList.slice()) x.reset();
    else activeList[Number(b.dataset.i)]?.reset();
  });
  initLayout();

  $("variable").addEventListener("input", () => {
    const wasStatic = state.cfg?.static, st = isStatic();
    if (st && !state.dual) { // el relieve no se compara: solo el mapa en bruto
      state.shown = { a: true, b: false, diff: false };
      $("panels").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.k === "a"));
      buildPanels();
    }
    const keep = currentLead(); refreshLeads(wasStatic ? 24 : keep); // al volver del relieve, alcance +24 h
    syncControls();
    state.filter = { op: "none", v1: NaN, v2: NaN }; syncFilterUI(0); // otra variable, otra unidad: el filtro de valores se reinicia
    update();
  });
  $("variable2").addEventListener("input", () => {
    refreshLeads(currentLead()); syncControls();
    state.sec.filter = { op: "none", v1: NaN, v2: NaN }; syncFilterUI(1);
    update();
  });
  // Una variable (con salida anterior y diferencia) o dos variables (última salida de cada una, con filtros independientes)
  $("modesw").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const dual = b.dataset.m === "2";
    if (dual === state.dual) return;
    state.dual = dual;
    if (dual) { state.savedShown = { ...state.shown }; state.shown = { a: true, b: false, diff: false }; }
    else if (state.savedShown) { state.shown = state.savedShown; state.savedShown = null; }
    $("modesw").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", (x.dataset.m === "2") === dual));
    $("panels").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", !!state.shown[x.dataset.k]));
    syncControls(); refreshLeads(currentLead()); buildPanels(); update();
  });
  $("offset").addEventListener("input", () => { refreshLeads(currentLead()); update(); });
  for (const id of ["date", "run"]) $(id).addEventListener("input", () => { refreshLeads(currentLead()); update(); }); // la hora de la salida decide qué alcances caen en validHours
  try { const v = localStorage.getItem("ukv.frames"); if (v && [...$("frames").options].some(o => o.value === v)) { $("frames").value = v; refreshLeads(currentLead()); } } catch { /* sin almacenamiento */ }
  $("frames").addEventListener("input", () => {
    try { localStorage.setItem("ukv.frames", $("frames").value); } catch { /* idem */ }
    refreshLeads(currentLead()); update();
  });
  // El deslizador actualiza la etiqueta al instante y descarga al soltar/pausar, no en cada paso.
  let timer;
  $("lead").addEventListener("input", () => {
    $("leadLabel").textContent = fcText(runTime(), currentLead());
    clearTimeout(timer); timer = setTimeout(update, 150);
  });
  const nudge = k => { $("lead").value = Math.min(leads.length - 1, Math.max(0, Number($("lead").value) + k)); update(); };
  $("prev").onclick = () => nudge(-1);
  $("next").onclick = () => nudge(1);

  try { state.contours = localStorage.getItem("ukv.contours") === "1"; } catch { /* sin almacenamiento */ }
  const syncContours = () => $("contoursw").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", (b.dataset.c === "1") === state.contours));
  syncContours();
  $("contoursw").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.contours = b.dataset.c === "1"; syncContours();
    try { localStorage.setItem("ukv.contours", state.contours ? "1" : "0"); } catch { /* idem */ }
    if (state.ovKey !== "same") { refreshLeads(currentLead()); update(); } // isolíneas de otra variable: hay que cargar sus datos
    else drawAll();
  });
  $("ovvar").addEventListener("input", () => { state.ovKey = $("ovvar").value; refreshLeads(currentLead()); syncControls(); update(); });
  $("region").addEventListener("input", () => { state.region = $("region").value; state.marksCache = {}; drawAll(); if (state.layers) drawStats(state.cfg, state.layers); }); // «zona visible» cambia el ámbito
  for (const [id, key] of [["marks", "marks"], ["scope", "scope"]]) {
    try { const v = localStorage.getItem("ukv." + key); if (v && [...$(id).options].some(o => o.value === v)) { $(id).value = v; state[key] = v; } } catch { /* sin almacenamiento */ }
    $(id).addEventListener("input", () => {
      const was = state[key];
      state[key] = $(id).value; state.marksCache = {};
      try { localStorage.setItem("ukv." + key, state[key]); } catch { /* idem */ }
      if (key === "marks" && (was === "highlow" || state.marks === "highlow")) { refreshLeads(currentLead()); update(); } // altas y bajas: hay que cargar la presión
      else if (state.layers) { drawAll(); drawStats(state.cfg, state.layers); }
    });
  }
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
