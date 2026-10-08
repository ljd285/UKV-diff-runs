# Plan: dashboard de comparación de pasadas UKV (03Z vs 15Z)

## Objetivo
Comparar visualmente las pasadas 03Z y 15Z del UKV (fuente: TheWeatherOutlook) para una misma hora de validez, en Tmáx, Tmín y punto de rocío, y navegar por horizontes fijos en un visor.

## Hallazgos de la investigación
- `ukv.aspx` es solo un envoltorio; el gráfico es un PNG estático:
  `https://www.theweatheroutlook.com/charts/ukv/{pasada}_{alcance}_{variable}.png`
- Pasadas: 03Z y 15Z. Alcances: 1–54 h cada hora, 57–120 h cada 3 h.
- Verificado (sonda en navegador): `max_temp`, `min_temp`, `dew_point`; prefijos `15` y `03`.
- Los ficheros se **sobrescriben**: no hay histórico. Solo existen la última pasada de cada hora.
- Emparejar por validez: la 03Z necesita alcance = alcance_15Z + 12 h.

### Ejemplos de emparejamiento (15Z de hoy como última pasada)
| Variable | Validez | 15Z | 03Z |
|---|---|---|---|
| Tmáx | 15Z día siguiente | `15_24_max_temp` | `03_36_max_temp` |
| Tmín | 06Z día siguiente | `15_15_min_temp` | `03_27_min_temp` |
| Rocío | 12Z, +2 días | `15_45_dew_point` | `03_57_dew_point` |

## Fases

### Fase 0 — Verificaciones (30 min, antes de escribir código)
1. ~~Probar nombres de dew point y prefijo~~ (hecho con la sonda, ver abajo).
2. Comprobar a qué hora UTC se actualiza cada pasada (para fijar el cron).
3. Comprobar si las imágenes de Tmáx/Tmín son valores instantáneos o agregados del periodo (cambia la interpretación de "validez").
4. Revisar las condiciones de uso de TWO antes de archivar sus imágenes; si no permiten redistribución, el repo/Pages debe ser privado o solo enlazar.

**Resultado (8 oct):** desde el entorno cloud de Claude Code, `theweatheroutlook.com` responde 403 de Cloudflare ("Sorry, you have been blocked") a cualquier petición, con cualquier nombre de fichero. Es un bloqueo de WAF por IP/tráfico automatizado, no un problema de nombres. No se intenta esquivar. Los puntos 1–3 quedan sin verificar y hay que comprobarlos desde un navegador normal (ver `scripts/probe.html` si se añade) o pidiendo permiso a TWO.
**Implicación para la Fase 2:** los runners de GitHub Actions también son IPs de datacenter y es probable que se bloqueen igual. Antes de construir el archivo hay que probar un workflow mínimo, o contactar con TWO, o usar el DataHub del Met Office.

**Actualización (sonda ejecutada en navegador, 8 oct 07:55Z):** verificado que el prefijo es `15` / `03` (`3_` no existe) y que el rocío es `dew_point`. Alcances 24 y 36 existen para ambas pasadas y las tres variables; todas las imágenes miden 690x840. Un `Last-Modified` observado: 05:44Z (≈2 h 45 min tras la 03Z; falta saber a qué fichero corresponde y confirmar el de la 15Z). Confirmado por el usuario: Tmáx/Tmín son de una hora concreta (no de un periodo de 24 h), así que emparejar por alcance es correcto.

**Prueba de runner (8 oct 08:10Z, [run 37748058621](https://github.com/ljd285/UKV-diff-runs/actions/runs/37748058621)):** un runner `ubuntu-latest` recibe también HTTP 403 de Cloudflare en los 3 ficheros probados (con User-Agent identificado). **El archivo automático desde GitHub Actions no es viable sin permiso de TWO.** Alternativas: pedir permiso/allowlist a TWO, usar Met Office DataHub, o un runner self-hosted en IP residencial (p. ej. un equipo propio).

### Fase 1 — Visor estático (MVP)
- `docs/index.html` (HTML/JS sin build) con: selector de variable, deslizador de validez (calcula alcance de cada pasada), vista lado a lado, modo superponer con opacidad, y 3 botones de ejemplo.
- Fallback de nombres de fichero y campo manual para dew point.
- Servido por GitHub Pages desde `/docs`.

### Fase 2 — Archivo propio con GitHub Actions
- `scripts/fetch.py`: descarga los PNG de las 3 variables y alcances configurables, a `docs/archive/{YYYY-MM-DD}/{run}/{variable}/{alcance}.png`, más `manifest.json` (índice de lo disponible, hashes, hora de descarga).
- Workflow `.github/workflows/fetch.yml`: cron ~07Z y ~19Z (ajustar con Fase 0), con reintentos, `workflow_dispatch`, commit del archivo a la rama de datos (`data`) para no ensuciar `main`.
- Retención: purgar >N días; limitar alcances (p. ej. 1–48 h) para controlar el tamaño del repo.
- El visor lee `manifest.json`: elige fecha, compara cualquier par de pasadas archivadas.

### Fase 3 — Mejoras
- Diferencia de píxeles en el servidor (Python/Pillow) y publicar un PNG de diferencias. Evita el límite CORS del navegador, aunque la escala de color sigue siendo frágil.
- Alternativa robusta para diferencias numéricas: datos UKV del Met Office DataHub (requiere API key en GitHub Secrets).
- Alertas/resumen cuando la diferencia entre pasadas supere un umbral.

## Estructura propuesta del repo
```
docs/            # GitHub Pages (visor + archive/)
scripts/fetch.py
.github/workflows/fetch.yml
PLAN.md
```

## Riesgos
- Términos de uso de TWO y posible bloqueo por descargas automáticas (usar User-Agent identificable, pocas peticiones).
- Cambios de nombre/formato de ficheros sin aviso.
- Pasada aún no publicada al ejecutar el cron (mitigar con reintentos y comprobando que el PNG cambió).
- Crecimiento del repo por PNG (retención y rama de datos).

## Siguiente paso
Ejecutar la Fase 0 y, con los resultados, construir la Fase 1 en esta rama (`claude/modest-gauss-rvtfq7`).

## Cambio de fuente: Met Office UKV 2 km en AWS Open Data (8 oct)

TWO bloquea a Actions (ver arriba), así que la fuente pasa a ser el bucket abierto `met-office-atmospheric-model-data` (eu-west-2), prefijo `uk-deterministic-2km/`.

**Verificado**
- Acceso anónimo desde este entorno y desde navegador: **CORS abierto** (`Access-Control-Allow-Origin: *`, también en el listado). Una app solo JS puede leerlo sin backend ni Actions.
- Un ciclo por hora (`YYYYMMDDTHH00Z/`), 17.557 ciclos (2 años de histórico, desde 2024-10-05). Los ciclos **03Z y 15Z llevan 120 h** (~5.000 ficheros, ~27 GB); los demás solo 12 h.
- Fichero: `{validez}-PT{alcance}H00M-{variable}.nc`, NetCDF4/HDF5, ~1,5 MB, malla 970x1042, 2 km, proyección Lambert azimutal de áreas iguales (origen 54,9N -2,5E), valores float32 en **kelvin**.
- Variables: `temperature_at_screen_level` (`air_temperature`), `temperature_at_screen_level_max-PT01H`, `..._min-PT01H`, `temperature_of_dew_point_at_screen_level` (`dew_point_temperature`).
- Los ciclos completos terminan de subirse ~4 h 15 min después de la hora del ciclo (03Z -> ~07:15Z, 15Z -> ~19:15Z).
- h5wasm (Node) lee estos ficheros correctamente.

**Por verificar**
- Que h5wasm funciona en el navegador con ficheros descargados por `fetch`.
- Un fichero `..._max-PT01H` dio 404 con el nombre construido a mano (alcance 36); comprobar el patrón exacto de nombres de max/min.
- Que la malla/proceso coincide con lo que dibuja TWO.

**Diseño propuesto (todo JS, sin backend)**
- Navegador: lista ciclos por S3, elige pasada A y B y alcance, descarga 2 ficheros (~3 MB), lee con h5wasm, resta B-A y pinta en `<canvas>` (diferencia, A y B) con lectura de valor al pasar el ratón y punto de interés por lat/lon (proyección LAEA a mano).
- Opcional: Actions solo para pre-calcular resúmenes (diferencia media/máx por región) si se quiere un panel histórico rápido.

## Estado del visor (8 oct)

- `docs/index.html` + `docs/app.js`: mapa de diferencias A − B de todo el UKV 2 km, leyendo el bucket directamente desde el navegador (h5wasm vendorizado en `docs/vendor/h5wasm`). Variables: T 1,5 m, Tmáx/Tmín última hora, rocío. Comparación con −12/−24/−36/−48 h. Vistas: diferencia (divergente azul/rojo, escala ±1..8 °C), pasada A y pasada B (secuencial azul). Puntos de ciudades sin nombre; costa Natural Earth 50 m (`scripts/build-coast.mjs` -> `docs/coast.json`). Estadísticos: media, MAE, RMSE, extremos, % celdas |Δ|>1 °C.
- `docs/laea.js`: proyección LAEA elipsoidal; coincide con pyproj al metro.
- El visor de imágenes de TWO queda en `docs/images.html`.
- Probado en Chromium con datos reales (claro y oscuro). Durante las pruebas el proxy del sandbox devolvió 404 intermitentes a ficheros que existen; el visor reintenta una vez.

## Variables del visor (8 oct)

Catálogo en `docs/variables.js`: temperatura 1,5 m, Tmáx/Tmín (última hora), rocío, presión a nivel del mar, viento y racha a 10 m, humedad relativa, nubosidad total y tasa de precipitación. Cada entrada define fichero, unidad y conversión, decimales, escalas ±, umbral, textos del signo y rango secuencial.

**Añadir una variable:** 1) localizar el fichero con `node scripts/explore-bucket.mjs` (o el listado S3); 2) abrir un fichero y anotar unidades y rango; 3) añadir una entrada en `VARIABLES` (y un grupo en `GROUPS` si hace falta). No hay que tocar `app.js`.

**Alcances:** la mayoría de variables solo existen cada hora hasta +54 h y cada 3 h de +57 a +120 h (`leads: "std"`); T 1,5 m, Tmáx y Tmín existen cada hora (Tmáx/Tmín desde +1 h). El deslizador solo ofrece alcances para los que existen A y B (corrige que el rocío daba 404 en +55, +56, +58...).

**Pendiente (no incluido):** variables de nivel (presión/altura, 17-65 MB por fichero), dirección de viento (requiere diferencia circular o componentes u/v), acumulados (`-PT01H` hasta +54 h y `-PT03H` desde +57 h: el sufijo cambia con el alcance).

## Viento: dirección y vectores (8 oct)

- Dos variables nuevas en el grupo "Viento a 10 m": **Dirección del viento (diferencia)** (`kind: "wdiff"`, diferencia circular en °, enmascarada donde el viento es < 1,5 m/s en A o B) y **Viento (vectores A y B)** (`kind: "vector"`, módulo de A − B en m/s). Ambas cargan `wind_direction_at_10m` + `wind_speed_at_10m` (4 ficheros por actualización, ~4-5 MB).
- Flechas de A y B en las tres vistas (A, B o ambas), una cada 96 km (media del bloque), longitud proporcional a la velocidad (máx. 20 m/s), con halo para leerse sobre cualquier fondo. Config en `ARROWS` (`docs/variables.js`).
- **Referencia de la dirección:** `wind_from_direction` (grados, de dónde sopla). Los ficheros no dicen si va respecto al norte verdadero o al de la malla. Contraste con balance geostrófico (24 campos, 3 ciclos): pendiente del desfase viento-geostrófico frente a x = −8 ± 1 °/1000 km; esperado 0 si fuera "malla" y ≈ −13 si fuera "norte verdadero" (y la fricción empujaría hacia valores menos negativos). Se asume **norte verdadero** (`WIND_DIR_REFERENCE`) y se giran las flechas la convergencia de meridianos (±13° en los bordes; `makeConvergence` en `docs/laea.js`, proyección inversa validada contra pyproj). Cambiar a `"grid"` si se confirma lo contrario. Las diferencias (circular y módulo vectorial) no dependen de esta elección.

## Cambios del visor tras el primer PR (8 oct)

- **Nombres:** "Última salida" y "Salida anterior" en lugar de pasada A/B.
- **Mapas en paralelo:** botones para mostrar a la vez Última salida, Salida anterior y Diferencia (cualquier combinación, mínimo uno). Cada panel con su título y su leyenda.
- **Zoom por zonas** (`docs/regions.js`): Reino Unido e Irlanda, dominio completo, las cuatro naciones, Escocia (Orkney y Shetland, Norte, Highlands, Sur), Gales (Norte, Sur) e Inglaterra (Norte, Pennines, Midlands, East Anglia, Suroeste, Sureste). Las cajas son aproximadas; se ajustan editando ese fichero. Los mapas se dibujan a la resolución de pantalla y la densidad de flechas se adapta al zoom.
- **Escala fija por variable** (`diffScale` y `range` en `docs/variables.js`), elegida variable a variable: T 1,5 m ±3 °C / −10…30; Tmáx ±3 / −5…35; Tmín ±3 / −10…20; rocío ±3 / −10…20 °C; presión ±2 / 980…1040 hPa; viento ±7 / 0…55 mph; racha ±10 / 0…80 mph; dirección ±30° (fondo 0…55 mph); vectores 0…7 mph (fondo 0…55 mph); humedad ±5 / 20…100 %; nubosidad ±25 / 0…100 %; precipitación ±0,5 / 0…4 mm/h.
- **Viento en mph** (factor 2,23694 desde m/s; las flechas siguen midiéndose internamente en m/s).
- **Sin texto "Descargando…":** durante la carga el mapa se atenúa y la altura de la página no cambia (la línea de validez y la de errores tienen hueco reservado). El deslizador espera 150 ms antes de descargar.

## Paletas de color por variable (8 oct)

Biblioteca en `docs/palettes.js` (generada por `scripts/build-palettes.py`: secuenciales, divergentes, versiones clara y oscura) y elección por variable en `docs/variables.js` (`palette: {map, diff}`, y `center` para una paleta de mapa divergente). Elegidas con muestras sobre datos reales:

| Variable | Mapa de cada salida | Diferencia |
|---|---|---|
| T 1,5 m, Tmáx, Tmín | Clásica meteorológica | Azul–rojo |
| Punto de rocío | Clásica meteorológica | Naranja–verde |
| Presión | Azul–rojo centrada en 1004 hPa (rango 980…1040) | Azul–rojo |
| Velocidad y racha del viento | Plasma | Púrpura–verde |
| Dirección del viento | Plasma (velocidad de fondo) | Marrón–verdeazulado |
| Viento (vectores) | Viridis (velocidad de fondo) | Módulo en amarillo–naranja–rojo |
| Humedad relativa | Amarillo–verde–azul | Marrón–verdeazulado |
| Nubosidad total | Viridis | Marrón–verdeazulado |
| Precipitación | Radar | Marrón–verdeazulado |

Para cambiar una paleta basta editar `palette` de esa variable; para añadir una, `build-palettes.py`. En la leyenda con `center` se indica el valor central y la barra respeta su posición real.

## De "medidor de diferencias" a "visor de datos" (8 oct)

- **Título y arranque:** "Visor de datos UKV"; por defecto se muestra solo la **Última salida** (datos en bruto). *Salida anterior* y *Diferencia* son opcionales.
- **Tooltip por panel:** en los mapas en bruto muestra el valor absoluto de esa salida (en el viento, velocidad y dirección); en el de diferencia, Δ más los valores de ambas salidas. Un valor que se redondea a cero no lleva signo (sin "−0.0").
- **La salida anterior solo se descarga si hace falta** (cuando se muestra ella o la diferencia). Sin ella, el desplegable "Comparar con" queda deshabilitado y el alcance llega a +120 h (con comparación, hasta +108 h por el desfase).
- **Estadísticas:** mínimo, media y máximo de cada mapa en bruto mostrado (en el viento, de la velocidad) y, si se muestra la diferencia, sus estadísticos de siempre.
- **Flechas** de cada salida solo cuando su panel (o la diferencia) está visible; la clave lo refleja.

## Filtro de valores (8 oct)

- **Qué hace:** fila "Filtro de valores" con operador (Sin filtro, Menor que, Mayor que, Entre), uno o dos umbrales en la unidad de la variable y atajos por variable. Las celdas que no cumplen quedan sin pintar. No descarga nada: solo repinta.
- **Dónde actúa:** en los mapas en bruto, sobre el valor de esa salida (en el viento, sobre la velocidad); en el mapa de **Diferencia**, en las celdas donde **cumple alguna de las dos salidas** (así se ve dónde cambió una situación que aparecía en una y no en la otra). También oculta las flechas del viento donde la velocidad no cumple.
- **Estadísticas:** mínimo, media y máximo solo de las celdas que cumplen, y el porcentaje de celdas que cumplen el filtro.
- **Título de cada panel:** indica el filtro activo (línea reservada: activarlo no desplaza los mapas).
- **Al cambiar de variable el filtro se reinicia** (otra unidad). Un segundo clic en un atajo activo lo quita.
- **Atajos** (`FILTER_PRESETS` en `docs/variables.js`): puntos de partida habituales, p. ej. helada < 0 °C, > 20 y > 30 °C, rachas > 40/50/60 mph, precipitación > 0,1 / 1 / 4 mm/h. Se editan o amplían allí sin tocar el visor.

## Altura del terreno y filtro de altitud (8 oct)

- **Datos:** `height_of_orography` (`surface_altitude`, metros, malla del modelo). Es **idéntico en todas las salidas y alcances** (comprobado), así que el visor lo descarga **una vez por sesión** (alcance 0) y lo reutiliza. Máximo en el dominio 3423 m (Alpes); el 68,8 % de las celdas está a 0 m (casi todo mar).
- **Variable "Altura del terreno"** (grupo "Terreno", `static: true` en `docs/variables.js`): se muestra solo en bruto, con paleta de relieve y rango 0…1000 m; no hay comparación y se deshabilitan el alcance, "Comparar con" y los mapas de Salida anterior y Diferencia. El filtro de valores funciona sobre ella (atajos > 100/300/600/900 m).
- **Filtro de altitud del terreno** (fila "Altitud del terreno"): "Desde X m" a "Hasta Y m" en pasos de 100 m, más atajos (< 100, 100–300, 300–600, > 600, > 900 m). Vale para **todas las variables**, se combina (Y) con el filtro de valores y afecta a mapas, flechas del viento, estadísticas y títulos. El intervalo es [desde, hasta): el límite superior no se incluye, así las bandas consecutivas no se solapan. Si se elige un máximo ≤ mínimo, se corrige a mínimo + 100 m.
- **Tooltip:** todos los mapas (menos el del propio relieve) añaden "Terreno N m".
- **Pendiente:** las celdas de mar tienen 0 m, así que bandas bajas como "< 100 m" incluyen mar. Para separar tierra y mar habría que cargar `landsea_mask` (77 ficheros, ~0,1 MB cada uno).
