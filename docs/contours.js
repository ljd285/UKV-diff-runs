// Isolíneas con "marching squares" sobre la malla del modelo (todo en el navegador).
// Las coordenadas de salida son índices de malla (i hacia el este, j hacia el norte); app.js las pasa a píxeles.

// Suavizado ligero [1 2 1]/4 en x e y, que ignora celdas sin dato: quita el ruido de 1-2 celdas que parte las líneas.
export function smoothField(data, nx, ny) {
  const tmp = new Float32Array(data.length), out = new Float32Array(data.length);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, c = data[k];
    if (!Number.isFinite(c)) { tmp[k] = NaN; continue; }
    let s = 2 * c, w = 2;
    if (i > 0 && Number.isFinite(data[k - 1])) { s += data[k - 1]; w++; }
    if (i < nx - 1 && Number.isFinite(data[k + 1])) { s += data[k + 1]; w++; }
    tmp[k] = s / w;
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, c = tmp[k];
    if (!Number.isFinite(c)) { out[k] = NaN; continue; }
    let s = 2 * c, w = 2;
    if (j > 0 && Number.isFinite(tmp[k - nx])) { s += tmp[k - nx]; w++; }
    if (j < ny - 1 && Number.isFinite(tmp[k + nx])) { s += tmp[k + nx]; w++; }
    out[k] = s / w;
  }
  return out;
}

// Niveles = múltiplos de `step` dentro de [lo, hi].
export function contourLevels(lo, hi, step) {
  const out = [];
  for (let n = Math.ceil(lo / step - 1e-9); n * step <= hi + 1e-9; n++) out.push(Number((n * step).toPrecision(12)));
  return out;
}

// minSegs: se descartan las líneas (cadenas de segmentos conectados) con menos segmentos: quita los bucles diminutos de ruido.
// Devuelve Map nivel → Float32Array [x1, y1, x2, y2, k, ...] (k = índice de la celda, para aplicar filtros).
export function buildContours(data, nx, ny, levels, minSegs = 0) {
  const segs = new Map(levels.map(l => [l, []]));
  if (!levels.length) return new Map();
  const ids = (e, k) => e === 0 ? k * 2 : e === 1 ? (k + 1) * 2 + 1 : e === 2 ? (k + nx) * 2 : k * 2 + 1; // id único de cada arista de la malla
  const l0 = levels[0], step = levels.length > 1 ? levels[1] - levels[0] : 1, nl = levels.length;
  const t = (l, a, b) => (l - a) / (b - a);
  const par = minSegs > 0 ? new Int32Array(2 * nx * ny).fill(-1) : null, cnt = par ? new Int32Array(2 * nx * ny) : null;
  const find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const union = (a, b) => { if (par[a] < 0) par[a] = a; if (par[b] < 0) par[b] = b; par[find(a)] = find(b); };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const v00 = data[k], v10 = data[k + 1], v01 = data[k + nx], v11 = data[k + nx + 1];
      if (!(Number.isFinite(v00) && Number.isFinite(v10) && Number.isFinite(v01) && Number.isFinite(v11))) continue;
      const mn = Math.min(v00, v10, v01, v11), mx = Math.max(v00, v10, v01, v11);
      let n0 = Math.floor((mn - l0) / step + 1e-9) + 1, n1 = Math.floor((mx - l0) / step + 1e-9);
      if (n0 < 0) n0 = 0; if (n1 > nl - 1) n1 = nl - 1;
      for (let n = n0; n <= n1; n++) {
        const l = levels[n];
        if (!(mn < l && l <= mx)) continue;
        const c = (v00 >= l ? 1 : 0) | (v10 >= l ? 2 : 0) | (v11 >= l ? 4 : 0) | (v01 >= l ? 8 : 0);
        if (c === 0 || c === 15) continue;
        const E = [ // puntos sobre las aristas: inferior, derecha, superior, izquierda
          () => [i + t(l, v00, v10), j], () => [i + 1, j + t(l, v10, v11)],
          () => [i + t(l, v01, v11), j + 1], () => [i, j + t(l, v00, v01)],
        ];
        let pairs;
        switch (c) {
          case 1: case 14: pairs = [[3, 0]]; break;
          case 2: case 13: pairs = [[0, 1]]; break;
          case 3: case 12: pairs = [[3, 1]]; break;
          case 4: case 11: pairs = [[1, 2]]; break;
          case 6: case 9: pairs = [[0, 2]]; break;
          case 7: case 8: pairs = [[3, 2]]; break;
          case 5: pairs = (v00 + v10 + v01 + v11) / 4 >= l ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]]; break;
          default: pairs = (v00 + v10 + v01 + v11) / 4 >= l ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]]; // 10
        }
        const arr = segs.get(l);
        for (const [a, b] of pairs) {
          const p = E[a](), q = E[b](), ea = ids(a, k), eb = ids(b, k);
          arr.push(p[0], p[1], q[0], q[1], k, ea, eb);
          if (par) union(ea, eb);
        }
      }
    }
  }
  const out = new Map();
  for (const [l, a] of segs) {
    let keep = a;
    if (par) {
      for (let q = 0; q < a.length; q += 7) cnt[find(a[q + 5])]++;
      keep = [];
      for (let q = 0; q < a.length; q += 7) if (cnt[find(a[q + 5])] >= minSegs) keep.push(a[q], a[q + 1], a[q + 2], a[q + 3], a[q + 4]);
      for (let q = 0; q < a.length; q += 7) cnt[find(a[q + 5])] = 0;
      for (let q = 0; q < a.length; q += 7) { par[a[q + 5]] = -1; par[a[q + 6]] = -1; }
    } else { keep = []; for (let q = 0; q < a.length; q += 7) keep.push(a[q], a[q + 1], a[q + 2], a[q + 3], a[q + 4]); }
    out.set(l, Float32Array.from(keep));
  }
  return out;
}
