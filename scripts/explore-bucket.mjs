// Explora el bucket abierto de Met Office (UKV 2 km) y comprueba que h5wasm puede leer un fichero.
// Uso: node scripts/explore-bucket.mjs
import h5wasm from "h5wasm/node";
import fs from "node:fs";

const BASE = "https://met-office-atmospheric-model-data.s3-eu-west-2.amazonaws.com";
const ROOT = "uk-deterministic-2km/";
const WANTED = [
  "temperature_at_screen_level",
  "temperature_at_screen_level_max-PT01H",
  "temperature_at_screen_level_min-PT01H",
  "temperature_of_dew_point_at_screen_level",
];

const tag = (x, t) => [...x.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, "g"))].map(m => m[1]);

// Lista paginada de claves (o prefijos con delimiter).
async function list(prefix, delimiter) {
  const out = { keys: [], prefixes: [] };
  let token = "";
  do {
    const u = `${BASE}/?list-type=2&max-keys=1000&prefix=${prefix}` +
      (delimiter ? `&delimiter=${delimiter}` : "") +
      (token ? `&continuation-token=${encodeURIComponent(token)}` : "");
    const res = await fetch(u);
    if (!res.ok) throw new Error(`${res.status} ${u}`);
    const x = await res.text();
    out.keys.push(...[...x.matchAll(/<Key>([^<]+)<\/Key><LastModified>([^<]+)<\/LastModified>.*?<Size>(\d+)<\/Size>/g)]
      .map(m => ({ key: m[1], modified: m[2], size: Number(m[3]) })));
    out.prefixes.push(...[...x.matchAll(/<CommonPrefixes><Prefix>([^<]+)/g)].map(m => m[1]));
    token = tag(x, "NextContinuationToken")[0] ?? "";
  } while (token);
  return out;
}

// 1) Ciclos disponibles (hay uno por hora; los de 03Z y 15Z llevan 120 h).
const { prefixes } = await list(ROOT, "/");
const cycles = prefixes.map(p => p.slice(ROOT.length, -1)).filter(Boolean).sort();
console.log(`Ciclos: ${cycles.length}, de ${cycles[0]} a ${cycles.at(-1)}`);

// 2) Último ciclo 03Z y 15Z: variables objetivo y horizontes.
const picks = ["T03", "T15"].map(h => cycles.filter(c => c.includes(h)).at(-1));
for (const c of picks) {
  const { keys } = await list(`${ROOT}${c}/`);
  console.log(`\n== ${c}: ${keys.length} ficheros, ${(keys.reduce((s, k) => s + k.size, 0) / 1e9).toFixed(1)} GB`);
  for (const w of WANTED) {
    const m = keys.filter(k => k.key.endsWith(`-${w}.nc`));
    const leads = m.map(k => Number(k.key.match(/-PT(\d+)H/)[1]));
    const mb = m.length ? (m.reduce((s, k) => s + k.size, 0) / m.length / 1e6).toFixed(2) : "-";
    console.log(`  ${w}: ${m.length} ficheros, alcance ${Math.min(...leads)}..${Math.max(...leads)} h, ~${mb} MB/fichero, subido ${m.at(-1)?.modified}`);
  }
}

// 3) Descarga un fichero y lo lee con h5wasm.
const c = picks[0];
const { keys } = await list(`${ROOT}${c}/`);
const sample = keys.find(k => k.key.includes("PT0024H00M-temperature_of_dew_point_at_screen_level.nc"));
const res = await fetch(`${BASE}/${sample.key}`);
fs.writeFileSync("/tmp/sample.nc", Buffer.from(await res.arrayBuffer()));
await h5wasm.ready;
const f = new h5wasm.File("/tmp/sample.nc", "r");
const v = f.get("dew_point_temperature");
let mn = Infinity, mx = -Infinity;
for (const x of v.value) { if (x < mn) mn = x; if (x > mx) mx = x; }
console.log(`\nLeído ${sample.key.split("/").pop()}\n  variable dew_point_temperature ${JSON.stringify(v.shape)} ${v.dtype}, min ${mn.toFixed(1)} K, max ${mx.toFixed(1)} K`);
console.log("  claves:", f.keys().join(", "));
f.close();
