// Zonas de zoom del visor. Cada zona es una caja [lonOeste, latSur, lonEste, latNorte] en grados;
// el visor la proyecta a la malla del modelo y recorta ese rectángulo. Para ajustar o añadir una zona
// basta editar esta lista (las cajas son aproximadas y pueden solaparse).
export const DEFAULT_REGION = "uk";

export const REGION_GROUPS = [
  {
    label: "Reino Unido",
    regions: [
      { id: "uk", label: "Reino Unido e Irlanda", box: [-10.8, 49.7, 2.2, 61.0] },
      { id: "grid", label: "Dominio completo del modelo", box: null },
    ],
  },
  {
    label: "Naciones",
    regions: [
      { id: "eng", label: "Inglaterra", box: [-6.5, 49.8, 2.0, 55.9] },
      { id: "sco", label: "Escocia", box: [-8.0, 54.5, -0.5, 61.0] },
      { id: "wal", label: "Gales", box: [-5.6, 51.3, -2.5, 53.5] },
      { id: "ni", label: "Irlanda del Norte", box: [-8.3, 54.0, -5.3, 55.4] },
    ],
  },
  {
    label: "Escocia",
    regions: [
      { id: "sco-isles", label: "Orkney y Shetland", box: [-3.6, 58.6, -0.6, 60.95] },
      { id: "sco-north", label: "Norte (Caithness y Sutherland)", box: [-5.9, 57.6, -2.5, 58.8] },
      { id: "sco-highlands", label: "Highlands", box: [-6.6, 56.3, -1.7, 57.7] },
      { id: "sco-south", label: "Sur (Lowlands y Borders)", box: [-6.0, 54.6, -1.7, 56.35] },
    ],
  },
  {
    label: "Gales",
    regions: [
      { id: "wal-north", label: "Norte de Gales", box: [-5.3, 52.6, -2.6, 53.5] },
      { id: "wal-south", label: "Sur de Gales", box: [-5.5, 51.3, -2.6, 52.7] },
    ],
  },
  {
    label: "Inglaterra",
    regions: [
      { id: "eng-north", label: "Norte", box: [-3.8, 54.4, -0.7, 55.85] },
      { id: "eng-pennines", label: "Pennines", box: [-3.2, 53.1, -1.2, 54.6] },
      { id: "eng-midlands", label: "Midlands", box: [-3.2, 51.9, -0.4, 53.1] },
      { id: "eng-eastanglia", label: "East Anglia", box: [-0.4, 51.8, 1.9, 53.0] },
      { id: "eng-southwest", label: "Suroeste", box: [-6.4, 49.8, -1.8, 51.7] },
      { id: "eng-southeast", label: "Sureste", box: [-1.9, 50.5, 1.6, 51.7] },
    ],
  },
];

export const REGIONS = Object.fromEntries(REGION_GROUPS.flatMap(g => g.regions.map(r => [r.id, r])));
