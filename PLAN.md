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
