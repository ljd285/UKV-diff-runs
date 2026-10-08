"""Genera docs/palettes.js (biblioteca de paletas del visor) muestreando algunos mapas de color de matplotlib.
Uso: python3 scripts/build-palettes.py
Las paletas hechas a mano se definen aquí; para añadir una basta una entrada y volver a ejecutar."""
import json, matplotlib
from matplotlib import colormaps
from matplotlib.colors import to_hex

def sample(name, n=9):
    cm = colormaps[name]
    return [to_hex(cm(i / (n - 1))) for i in range(n)]

# Secuenciales: de valor bajo a valor alto. lightLow=True: el extremo bajo es claro (se invierte en modo oscuro);
# `dark` fija a mano la versión oscura cuando invertir no tiene sentido.
SEQUENTIAL = {
    "azul":    dict(label="Azul", stops=["#dbe9fb", "#2a78d6", "#0d366b"], dark=["#0d366b", "#2a78d6", "#b7d3f6"]),
    "viridis": dict(label="Viridis", stops=sample("viridis")),
    "magma":   dict(label="Magma", stops=sample("magma")),
    "inferno": dict(label="Inferno", stops=sample("inferno")),
    "plasma":  dict(label="Plasma", stops=sample("plasma")),
    "ylorrd":  dict(label="Amarillo–naranja–rojo", stops=["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"],
                    dark=["#3a2a0a", "#8a5a14", "#fd8d3c", "#ff5a4a", "#ffd0c8"]),
    "ylgnbu":  dict(label="Amarillo–verde–azul", stops=["#ffffd9", "#c7e9b4", "#41b6c4", "#225ea8", "#081d58"],
                    dark=["#081d58", "#225ea8", "#41b6c4", "#c7e9b4", "#ffffd9"]),
    "gnbu":    dict(label="Verde–azul", stops=["#f7fcf0", "#ccebc5", "#7bccc4", "#2b8cbe", "#084081"],
                    dark=["#084081", "#2b8cbe", "#7bccc4", "#ccebc5", "#f7fcf0"]),
    "gris":    dict(label="Grises", stops=["#f5f5f5", "#bdbdbd", "#636363", "#1c1c1c"],
                    dark=["#1c1c1c", "#636363", "#bdbdbd", "#f5f5f5"]),
    "radar":   dict(label="Radar", stops=["#eef2f6", "#a7dcae", "#4cb85a", "#f4e04d", "#f2902f", "#d8261d", "#a01a94"],
                    dark=["#262b31", "#3f7f4c", "#4cb85a", "#f4e04d", "#f2902f", "#ff5a4a", "#d36bd0"]),
    "relieve": dict(label="Relieve", stops=["#d7e8d4", "#9ccb86", "#e3d77a", "#c99a52", "#8c5e3c", "#f4f1ec"],
                    dark=["#1c3324", "#3c6d3f", "#9a8f3a", "#a8733a", "#7a5a45", "#e8e4dc"]),
    "clasica": dict(label="Clásica meteorológica", stops=["#3b1f8f", "#2a6fd6", "#35b6c8", "#5cc86a", "#f1e04a", "#f08a2a", "#d7261e", "#7a0c2a"]),
}
# Divergentes: del extremo negativo, pasando por un gris neutro, al positivo. Versión clara y oscura.
DIVERGING = {
    "azul-rojo": dict(label="Azul–rojo",
                      light=["#184f95", "#6da7ec", "#f0efec", "#f08c7a", "#a8201a"],
                      dark=["#9ec5f4", "#2a78d6", "#383835", "#c0392b", "#ff9d8a"]),
    "puor":      dict(label="Púrpura–naranja",
                      light=["#5e3c99", "#b2abd2", "#f0efec", "#fdb863", "#e66101"],
                      dark=["#d0c5f5", "#7e63c9", "#383835", "#c8601a", "#ffbf8a"]),
    "brbg":      dict(label="Marrón–verdeazulado",
                      light=["#8c510a", "#d8b365", "#f0efec", "#5ab4ac", "#01665e"],
                      dark=["#f0d79a", "#b9852f", "#383835", "#2f9e96", "#9fe0d8"]),
    "naranja-verde": dict(label="Naranja–verde",
                      light=["#b35806", "#f1a340", "#f0efec", "#8cc98a", "#1b7837"],
                      dark=["#ffc08a", "#d8741e", "#383835", "#4fa35a", "#b9ecb4"]),
    "prgn":      dict(label="Púrpura–verde",
                      light=["#762a83", "#c2a5cf", "#f0efec", "#a6dba0", "#1b7837"],
                      dark=["#e3c4ee", "#9a5fb0", "#383835", "#4fa35a", "#b9ecb4"]),
}

js = ("// Biblioteca de paletas del visor. GENERADO por scripts/build-palettes.py (se puede editar a mano, pero se pisará al regenerar).\n"
      "// SEQUENTIAL: {label, stops (bajo→alto), dark?}; sin `dark`, la paleta es la misma en modo oscuro.\n"
      "// DIVERGING: {label, light, dark}: negativo → gris neutro → positivo.\n"
      f"export const SEQUENTIAL = {json.dumps(SEQUENTIAL, ensure_ascii=False, indent=2)};\n\n"
      f"export const DIVERGING = {json.dumps(DIVERGING, ensure_ascii=False, indent=2)};\n")
open("docs/palettes.js", "w").write(js)
print("docs/palettes.js:", len(SEQUENTIAL), "secuenciales,", len(DIVERGING), "divergentes")
