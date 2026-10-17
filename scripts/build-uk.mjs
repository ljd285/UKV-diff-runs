// Genera docs/uk.json: contorno del Reino Unido (Natural Earth 1:10m, vía world-atlas) para el ámbito «Solo Reino Unido».
// Formato: lista de anillos [[lon, lat], ...] (islas incluidas), redondeados a 2 decimales (~1 km) y simplificados.
// Uso: node scripts/build-uk.mjs
import fs from "node:fs";
import { feature } from "topojson-client";

const topo = JSON.parse(fs.readFileSync("node_modules/world-atlas/countries-10m.json", "utf8"));
const uk = feature(topo, topo.objects.countries).features.find(f => f.properties.name === "United Kingdom");
if (!uk) throw new Error("No se encuentra el Reino Unido en world-atlas");
const r = n => Math.round(n * 100) / 100;

// Simplificación Douglas–Peucker (tolerancia en grados) para recortar puntos sin cambiar la forma a escala de 2 km.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
  let imax = 0, dmax = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * (pts[i][0] - ax) - dx * (pts[i][1] - ay)) / len;
    if (d > dmax) { dmax = d; imax = i; }
  }
  if (dmax <= tol) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, imax + 1), tol).slice(0, -1), ...simplify(pts.slice(imax), tol)];
}

const polys = uk.geometry.type === "Polygon" ? [uk.geometry.coordinates] : uk.geometry.coordinates;
const rings = [];
for (const poly of polys) {
  for (const ring of poly) { // el primer anillo es el exterior; el resto, huecos (no hay en el UK, pero se conservan)
    // el anillo es cerrado (primer punto = último): se simplifica por mitades para que Douglas–Peucker no lo colapse
    const m = ring.length >> 1, s = [...simplify(ring.slice(0, m + 1), 0.01).slice(0, -1), ...simplify(ring.slice(m), 0.01)].map(([x, y]) => [r(x), r(y)]);
    if (s.length >= 4) rings.push(s);
  }
}
fs.writeFileSync("docs/uk.json", JSON.stringify(rings));
console.log(`${rings.length} anillos, ${rings.reduce((s, x) => s + x.length, 0)} puntos, ${fs.statSync("docs/uk.json").size} bytes`);
