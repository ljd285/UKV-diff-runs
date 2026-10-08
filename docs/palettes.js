// Biblioteca de paletas del visor. GENERADO por scripts/build-palettes.py (se puede editar a mano, pero se pisará al regenerar).
// SEQUENTIAL: {label, stops (bajo→alto), dark?}; sin `dark`, la paleta es la misma en modo oscuro.
// DIVERGING: {label, light, dark}: negativo → gris neutro → positivo.
export const SEQUENTIAL = {
  "azul": {
    "label": "Azul",
    "stops": [
      "#dbe9fb",
      "#2a78d6",
      "#0d366b"
    ],
    "dark": [
      "#0d366b",
      "#2a78d6",
      "#b7d3f6"
    ]
  },
  "viridis": {
    "label": "Viridis",
    "stops": [
      "#440154",
      "#472d7b",
      "#3b528b",
      "#2c728e",
      "#21918c",
      "#28ae80",
      "#5ec962",
      "#addc30",
      "#fde725"
    ]
  },
  "magma": {
    "label": "Magma",
    "stops": [
      "#000004",
      "#1d1147",
      "#51127c",
      "#832681",
      "#b73779",
      "#e75263",
      "#fc8961",
      "#fec488",
      "#fcfdbf"
    ]
  },
  "inferno": {
    "label": "Inferno",
    "stops": [
      "#000004",
      "#210c4a",
      "#57106e",
      "#8a226a",
      "#bc3754",
      "#e45a31",
      "#f98e09",
      "#f9cb35",
      "#fcffa4"
    ]
  },
  "plasma": {
    "label": "Plasma",
    "stops": [
      "#0d0887",
      "#4c02a1",
      "#7e03a8",
      "#aa2395",
      "#cc4778",
      "#e66c5c",
      "#f89540",
      "#fdc527",
      "#f0f921"
    ]
  },
  "ylorrd": {
    "label": "Amarillo–naranja–rojo",
    "stops": [
      "#ffffcc",
      "#fed976",
      "#fd8d3c",
      "#e31a1c",
      "#800026"
    ],
    "dark": [
      "#3a2a0a",
      "#8a5a14",
      "#fd8d3c",
      "#ff5a4a",
      "#ffd0c8"
    ]
  },
  "ylgnbu": {
    "label": "Amarillo–verde–azul",
    "stops": [
      "#ffffd9",
      "#c7e9b4",
      "#41b6c4",
      "#225ea8",
      "#081d58"
    ],
    "dark": [
      "#081d58",
      "#225ea8",
      "#41b6c4",
      "#c7e9b4",
      "#ffffd9"
    ]
  },
  "gnbu": {
    "label": "Verde–azul",
    "stops": [
      "#f7fcf0",
      "#ccebc5",
      "#7bccc4",
      "#2b8cbe",
      "#084081"
    ],
    "dark": [
      "#084081",
      "#2b8cbe",
      "#7bccc4",
      "#ccebc5",
      "#f7fcf0"
    ]
  },
  "gris": {
    "label": "Grises",
    "stops": [
      "#f5f5f5",
      "#bdbdbd",
      "#636363",
      "#1c1c1c"
    ],
    "dark": [
      "#1c1c1c",
      "#636363",
      "#bdbdbd",
      "#f5f5f5"
    ]
  },
  "radar": {
    "label": "Radar",
    "stops": [
      "#eef2f6",
      "#a7dcae",
      "#4cb85a",
      "#f4e04d",
      "#f2902f",
      "#d8261d",
      "#a01a94"
    ],
    "dark": [
      "#262b31",
      "#3f7f4c",
      "#4cb85a",
      "#f4e04d",
      "#f2902f",
      "#ff5a4a",
      "#d36bd0"
    ]
  },
  "clasica": {
    "label": "Clásica meteorológica",
    "stops": [
      "#3b1f8f",
      "#2a6fd6",
      "#35b6c8",
      "#5cc86a",
      "#f1e04a",
      "#f08a2a",
      "#d7261e",
      "#7a0c2a"
    ]
  }
};

export const DIVERGING = {
  "azul-rojo": {
    "label": "Azul–rojo",
    "light": [
      "#184f95",
      "#6da7ec",
      "#f0efec",
      "#f08c7a",
      "#a8201a"
    ],
    "dark": [
      "#9ec5f4",
      "#2a78d6",
      "#383835",
      "#c0392b",
      "#ff9d8a"
    ]
  },
  "puor": {
    "label": "Púrpura–naranja",
    "light": [
      "#5e3c99",
      "#b2abd2",
      "#f0efec",
      "#fdb863",
      "#e66101"
    ],
    "dark": [
      "#d0c5f5",
      "#7e63c9",
      "#383835",
      "#c8601a",
      "#ffbf8a"
    ]
  },
  "brbg": {
    "label": "Marrón–verdeazulado",
    "light": [
      "#8c510a",
      "#d8b365",
      "#f0efec",
      "#5ab4ac",
      "#01665e"
    ],
    "dark": [
      "#f0d79a",
      "#b9852f",
      "#383835",
      "#2f9e96",
      "#9fe0d8"
    ]
  },
  "naranja-verde": {
    "label": "Naranja–verde",
    "light": [
      "#b35806",
      "#f1a340",
      "#f0efec",
      "#8cc98a",
      "#1b7837"
    ],
    "dark": [
      "#ffc08a",
      "#d8741e",
      "#383835",
      "#4fa35a",
      "#b9ecb4"
    ]
  },
  "prgn": {
    "label": "Púrpura–verde",
    "light": [
      "#762a83",
      "#c2a5cf",
      "#f0efec",
      "#a6dba0",
      "#1b7837"
    ],
    "dark": [
      "#e3c4ee",
      "#9a5fb0",
      "#383835",
      "#4fa35a",
      "#b9ecb4"
    ]
  }
};
