// Genera docs/coast.json: líneas de costa (Natural Earth 1:50m, vía world-atlas) recortadas a la zona del UKV.
// Uso: node scripts/build-coast.mjs
import fs from "node:fs";
import { feature } from "topojson-client";

const topo = JSON.parse(fs.readFileSync("node_modules/world-atlas/land-50m.json", "utf8"));
const land = feature(topo, topo.objects.land);
const [W, S, E, N] = [-24, 43, 18, 65];
const inside = ([x, y]) => x >= W && x <= E && y >= S && y <= N;
const r = n => Math.round(n * 100) / 100;

const rings = [];
for (const f of land.features ?? [land]) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) {
    // Se parte el anillo en tramos que quedan dentro de la caja para no dibujar líneas espurias.
    let run = [];
    for (const p of ring) {
      if (inside(p)) run.push([r(p[0]), r(p[1])]);
      else if (run.length > 1) { rings.push(run); run = []; } else run = [];
    }
    if (run.length > 1) rings.push(run);
  }
}
fs.writeFileSync("docs/coast.json", JSON.stringify(rings));
console.log(`${rings.length} tramos, ${rings.reduce((s, x) => s + x.length, 0)} puntos`);
