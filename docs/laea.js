// Proyección Lambert azimutal de áreas iguales (elipsoidal, Snyder 1987) con los parámetros del UKV 2 km:
// elipsoide WGS84, origen 54,9N 2,5W. Devuelve metros (x este, y norte) sobre la malla del modelo.
const A = 6378137.0;
const B = 6356752.314140356;
const E2 = 1 - (B * B) / (A * A);
const E = Math.sqrt(E2);
const RAD = Math.PI / 180;

const q = phi => {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
};

export function makeLaea(lat0 = 54.9, lon0 = -2.5) {
  const phi0 = lat0 * RAD;
  const qp = q(Math.PI / 2);
  const beta0 = Math.asin(q(phi0) / qp);
  const Rq = A * Math.sqrt(qp / 2);
  const D = (A * Math.cos(phi0)) / Math.sqrt(1 - E2 * Math.sin(phi0) ** 2) / (Rq * Math.cos(beta0));
  return function forward(lon, lat) {
    const dl = (lon - lon0) * RAD;
    const beta = Math.asin(q(lat * RAD) / qp);
    const k = Rq * Math.sqrt(2 / (1 + Math.sin(beta0) * Math.sin(beta) + Math.cos(beta0) * Math.cos(beta) * Math.cos(dl)));
    return [
      k * D * Math.cos(beta) * Math.sin(dl),
      (k / D) * (Math.cos(beta0) * Math.sin(beta) - Math.sin(beta0) * Math.cos(beta) * Math.cos(dl)),
    ];
  };
}
