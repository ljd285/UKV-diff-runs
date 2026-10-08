// Proyección Lambert azimutal de áreas iguales (elipsoidal, Snyder 1987) con los parámetros del UKV 2 km:
// elipsoide WGS84, origen 54,9N 2,5W. Trabaja en metros (x este, y norte) sobre la malla del modelo.
const A = 6378137.0;
const B = 6356752.314140356;
const E2 = 1 - (B * B) / (A * A);
const E = Math.sqrt(E2);
const RAD = Math.PI / 180;

const q = phi => {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
};

function setup(lat0, lon0) {
  const phi0 = lat0 * RAD;
  const qp = q(Math.PI / 2);
  const beta0 = Math.asin(q(phi0) / qp);
  const Rq = A * Math.sqrt(qp / 2);
  const D = (A * Math.cos(phi0)) / Math.sqrt(1 - E2 * Math.sin(phi0) ** 2) / (Rq * Math.cos(beta0));
  return { lon0, lat0, qp, beta0, Rq, D };
}

// (lon, lat) en grados -> [x, y] en metros.
export function makeLaea(lat0 = 54.9, lon0 = -2.5) {
  const { qp, beta0, Rq, D } = setup(lat0, lon0);
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

// [x, y] en metros -> [lon, lat] en grados.
export function makeLaeaInverse(lat0 = 54.9, lon0 = -2.5) {
  const { beta0, Rq, D } = setup(lat0, lon0);
  const c1 = E2 / 3 + (31 * E2 ** 2) / 180 + (517 * E2 ** 3) / 5040;
  const c2 = (23 * E2 ** 2) / 360 + (251 * E2 ** 3) / 3780;
  const c3 = (761 * E2 ** 3) / 45360;
  return function inverse(x, y) {
    const rho = Math.hypot(x / D, D * y);
    if (rho === 0) return [lon0, lat0];
    const ce = 2 * Math.asin(rho / (2 * Rq));
    const beta = Math.asin(Math.cos(ce) * Math.sin(beta0) + (D * y * Math.sin(ce) * Math.cos(beta0)) / rho);
    const lon = lon0 + Math.atan2(x * Math.sin(ce), D * rho * Math.cos(beta0) * Math.cos(ce) - D * D * y * Math.sin(beta0) * Math.sin(ce)) / RAD;
    const lat = beta + c1 * Math.sin(2 * beta) + c2 * Math.sin(4 * beta) + c3 * Math.sin(6 * beta);
    return [lon, lat / RAD];
  };
}

// Convergencia de meridianos en (x, y): ángulo (radianes) del norte verdadero medido en sentido horario
// desde el norte de la malla (+y). Sirve para pasar vectores de ejes (este, norte) verdaderos a ejes de la malla.
export function makeConvergence(lat0 = 54.9, lon0 = -2.5) {
  const forward = makeLaea(lat0, lon0), inverse = makeLaeaInverse(lat0, lon0);
  return function convergence(x, y) {
    const [lon, lat] = inverse(x, y);
    const [x2, y2] = forward(lon, lat + 0.01);
    return Math.atan2(x2 - x, y2 - y);
  };
}
