// Catálogo de variables del visor. Para añadir una variable basta con una entrada en VARIABLES
// (y, si es un grupo nuevo, otra en GROUPS). Nada más del código depende de variables concretas.
//
// Campos:
//   label, group      Texto del selector y grupo (optgroup).
//   file              Nombre en el bucket: {validez}-PT{alcance}H00M-{file}.nc
//   unit              Unidad que se muestra.
//   factor, offset    Conversión del valor del fichero: mostrado = bruto * factor + offset
//                     (las diferencias solo usan factor).
//   decimals          Decimales al mostrar valores y estadísticas.
//   diffScale         Escala FIJA de la diferencia: ±diffScale en `unit` (para kind "vector": de 0 a diffScale).
//   range             Rango FIJO [min, max] de los mapas de cada salida, en la unidad mostrada (viewUnit para el viento).
//   thresh            Umbral para la estadística "celdas con |Δ| > umbral" (en `unit`).
//   pos, neg          Texto de "A es más ..." para diferencias positivas / negativas.
//   leads             "any": existe cada hora de 0 a 120 h.
//                     "std": cada hora hasta +54 h y cada 3 h de +57 h a +120 h (lo habitual).
//   minLead           Primer alcance disponible (por defecto 0).
//   kind              "scalar" (por defecto): un fichero, campo escalar.
//                     "wdiff":  viento; mapa = diferencia circular de dirección (°), enmascarada donde el viento es flojo.
//                     "vector": viento; mapa = módulo de la diferencia vectorial |A − B| (secuencial, desde 0).
//                     En ambos hay flechas de A y B, y las vistas A/B muestran la velocidad de fondo.
//   files             Para kind != "scalar": {dir, speed} en lugar de `file`.
//   viewUnit/viewDecimals  Unidad y decimales de las vistas A/B y del tooltip si difieren de `unit` (viento: m/s).
//   minSpeed          (wdiff) velocidad mínima (m/s) en ambas pasadas para dibujar la diferencia de dirección.
//
// Cómo localizar variables nuevas: `node scripts/explore-bucket.mjs` lista las variables de un ciclo
// con su rango de alcances; el nombre interno y las unidades se ven abriendo un fichero (h5wasm/netCDF4).

export const GROUPS = [
  { id: "temp", label: "Temperatura" },
  { id: "pres", label: "Presión" },
  { id: "wind", label: "Viento a 10 m" },
  { id: "moist", label: "Humedad y nubes" },
  { id: "precip", label: "Precipitación" },
];

const KELVIN = { factor: 1, offset: -273.15, unit: "°C", decimals: 1, diffScale: 3, range: [-5, 25], thresh: 1, pos: "más cálida", neg: "más fría" };

export const VARIABLES = {
  t:    { ...KELVIN, label: "Temperatura a 1,5 m", group: "temp", file: "temperature_at_screen_level", leads: "any" },
  tmax: { ...KELVIN, label: "Temperatura máxima (última hora)", group: "temp", file: "temperature_at_screen_level_max-PT01H", leads: "any", minLead: 1 },
  tmin: { ...KELVIN, label: "Temperatura mínima (última hora)", group: "temp", file: "temperature_at_screen_level_min-PT01H", leads: "any", minLead: 1 },
  td:   { ...KELVIN, label: "Punto de rocío", group: "temp", file: "temperature_of_dew_point_at_screen_level", leads: "std" },

  pmsl: {
    label: "Presión a nivel del mar", group: "pres", file: "pressure_at_mean_sea_level", leads: "std",
    unit: "hPa", factor: 0.01, offset: 0, decimals: 1, diffScale: 2, range: [980, 1040], thresh: 1,
    pos: "más alta", neg: "más baja",
  },

  wind: {
    label: "Velocidad del viento", group: "wind", file: "wind_speed_at_10m", leads: "std",
    unit: "m/s", factor: 1, offset: 0, decimals: 1, diffScale: 3, range: [0, 25], thresh: 2,
    pos: "más fuerte", neg: "más débil",
  },
  gust: {
    label: "Racha de viento", group: "wind", file: "wind_gust_at_10m", leads: "std",
    unit: "m/s", factor: 1, offset: 0, decimals: 1, diffScale: 3, range: [0, 35], thresh: 2,
    pos: "más fuerte", neg: "más débil",
  },

  wdir: {
    label: "Dirección del viento (diferencia)", group: "wind", kind: "wdiff", leads: "std",
    files: { dir: "wind_direction_at_10m", speed: "wind_speed_at_10m" },
    unit: "°", factor: 1, offset: 0, decimals: 0, viewUnit: "m/s", viewDecimals: 1,
    diffScale: 30, range: [0, 25], thresh: 30, minSpeed: 1.5,
    pos: "rolada en sentido horario", neg: "rolada en sentido antihorario",
  },
  wvec: {
    label: "Viento (vectores A y B)", group: "wind", kind: "vector", leads: "std",
    files: { dir: "wind_direction_at_10m", speed: "wind_speed_at_10m" },
    unit: "m/s", factor: 1, offset: 0, decimals: 1,
    diffScale: 3, range: [0, 25], thresh: 2, pos: "", neg: "",
  },

  rh: {
    label: "Humedad relativa", group: "moist", file: "relative_humidity_at_screen_level", leads: "std",
    unit: "%", factor: 100, offset: 0, decimals: 0, diffScale: 10, range: [0, 100], thresh: 10,
    pos: "más húmeda", neg: "más seca",
  },
  cloud: {
    label: "Nubosidad total", group: "moist", file: "cloud_amount_of_total_cloud", leads: "std",
    unit: "%", factor: 100, offset: 0, decimals: 0, diffScale: 25, range: [0, 100], thresh: 25,
    pos: "más nublada", neg: "más despejada",
  },

  precip: {
    label: "Tasa de precipitación (equiv. líquido)", group: "precip", file: "precipitation_rate", leads: "std",
    unit: "mm/h", factor: 3.6e6, offset: 0, decimals: 2, diffScale: 0.5, range: [0, 4], thresh: 0.25,
    pos: "más lluvia", neg: "menos lluvia",
  },
};

// Flechas de viento: separadas `spacing` píxeles de pantalla (media del bloque de celdas correspondiente, así que la densidad
// se adapta al zoom), longitud proporcional a la velocidad hasta `vref` (m/s).
export const ARROWS = { spacing: 34, vref: 20, minSpeed: 0.5, minLen: 5 };

// Referencia de la dirección en los ficheros: "north" (norte verdadero) o "grid" (norte de la malla).
// Los datos lo sugieren (balance geostrófico en 24 campos: pendiente −8 ± 1 °/1000 km; 0 si fuera "grid", ≈ −13 si "north"),
// pero no está documentado en los ficheros. Con "north" las flechas se giran la convergencia de meridianos (hasta ±13°).
export const WIND_DIR_REFERENCE = "north";

export const DEFAULT_VARIABLE = "t";
export const MAX_LEAD = 120;

// ¿Existe fichero para este alcance (horas)?
export function leadExists(cfg, h) {
  if (h < (cfg.minLead ?? 0) || h > MAX_LEAD) return false;
  return cfg.leads === "any" || h <= 54 || (h - 54) % 3 === 0;
}

// Alcances de la pasada A para los que existen A y B (B = A + offset horas).
export function validLeads(cfg, offset) {
  const out = [];
  for (let h = 0; h + offset <= MAX_LEAD; h++) if (leadExists(cfg, h) && leadExists(cfg, h + offset)) out.push(h);
  return out;
}
