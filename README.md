# Prueba Tecnica — Integra Grupo Alerta

Aplicacion web desarrollada como prueba tecnica para la vacante de Desarrollador Jr. en Integra TI.

## Demo

Disponible en Firebase Hosting: https://grupoalerta-9ddf1.web.app

---

## Descripcion

Aplicacion React con tres modulos funcionales independientes, presentados mediante navegacion por pestanas:

| Modulo | Opcion del enunciado |
|--------|----------------------|
| Procesador XML (CFDI) | Opcion 1 |
| Analisis CSV / Excel | Opcion 2 |
| Registros con Historial | Opcion 3 |

Se decidio implementar las tres opciones en lugar de una sola para demostrar el manejo de distintas tecnologias dentro de un mismo proyecto.

---

## Modulos

### 01 — Procesador XML (CFDI)

Permite cargar un archivo XML de factura electronica (CFDI SAT Mexico) y extraer su contenido estructurado.

Funcionalidades:
- Carga por seleccion de archivo o arrastrar y soltar
- Compatibilidad con CFDI 3.3 y 4.0 (manejo de namespaces)
- Extraccion de: Folio, Fecha, Emisor (nombre, RFC, regimen), Receptor (nombre, RFC, uso CFDI), Total, SubTotal, Moneda y lista de Conceptos
- Validaciones: archivo vacio, XML malformado, nodos faltantes, Total no numerico
- Guardado del documento en Firestore con verificacion opcional de duplicados por folio
- Visualizacion del XML original en pantalla

### 02 — Analisis CSV / Excel

Permite cargar archivos tabulares y generar un resumen del contenido.

Funcionalidades:
- Soporte para .csv, .xlsx y .xls
- Deteccion automatica de columnas (insensible a mayusculas y acentos)
- Columnas requeridas: Folio, Fecha, Categoria, Monto, Estatus
- Validaciones por fila: campos vacios, montos no numericos, fechas con formato incorrecto
- Deteccion de folios duplicados
- Resumen agrupado por estatus y por categoria (conteo y suma de montos)
- Filtro por texto y por estatus
- Exportar registros validos a CSV
- Guardado del analisis en Firestore

### 03 — Registros con Historial de Cambios

CRUD de registros con auditoria automatica de cambios.

Funcionalidades:
- Crear registros con validacion de folio unico
- Listar registros con filtros por estado y folio
- Actualizar estado con motivo obligatorio
- Registro automatico de historial en creacion y actualizacion
- Eliminacion logica (soft delete) con evento en historial
- Panel de detalle con linea de tiempo de eventos por registro
- Historial global de eventos (ultimos 50)
- Actualizaciones en tiempo real mediante Firestore onSnapshot

---

## Tecnologias

- React 18 con TypeScript
- Vite
- Firebase (Firestore + Hosting)
- PapaParse — lectura de archivos CSV
- SheetJS (xlsx) — lectura de archivos Excel
- CSS vanilla, tema corporativo claro

---

## Instrucciones para ejecutar

Requisitos previos: Node.js >= 18, npm >= 9

```bash
# 1. Instalar dependencias
npm install

# 2. Ejecutar la aplicacion web (Frontend) en modo desarrollo
npm run dev
# Disponible en http://localhost:5173

# 3. Ejecutar la API REST (Backend para la Opcion 3)
npm run api
# Disponible en http://localhost:3001

# 4. Build de produccion del Frontend
npm run build

# 5. Desplegar a Firebase Hosting
firebase deploy --only hosting
```

### Endpoints de la API (Opcion 3)

La API REST fue construida con Express.js y se conecta a la misma base de datos Firestore.

- `GET /api/registros` — Obtiene todos los registros activos.
- `GET /api/registros/:id` — Obtiene un registro por ID junto con su historial de eventos.
- `POST /api/registros` — Crea un nuevo registro. Requiere `{ "folio": "...", "descripcion": "..." }`.
- `PATCH /api/registros/:id/estado` — Actualiza el estado. Requiere `{ "estado": "...", "motivo": "..." }`.

### Variables de entorno

El proyecto incluye la configuracion de Firebase directamente en `src/lib/firebase.ts` y en `server.js` para facilitar la ejecucion de la prueba. Para un entorno real, use `.env`.

---

## Estructura del proyecto

```
src/
  components/
    XMLProcessor.tsx    # Modulo 1 — parser XML CFDI
    CSVAnalyzer.tsx     # Modulo 2 — analisis CSV/Excel
    RecordsHistory.tsx  # Modulo 3 — registros con historial
  lib/
    firebase.ts         # Inicializacion de Firebase
  App.tsx               # Shell de la aplicacion y navegacion
  main.tsx              # Punto de entrada
  index.css             # Estilos globales
```

## Colecciones en Firestore

| Coleccion | Descripcion |
|-----------|-------------|
| `xml_documentos` | Documentos CFDI procesados |
| `csv_analisis` | Resultados de analisis de archivos tabulares |
| `registros` | Entidad principal del modulo de historial |
| `historial` | Eventos de auditoria por registro |

---

## Decisiones tecnicas

**Sin backend separado.** El procesamiento de XML y CSV se realiza en el cliente (navegador). Para un entorno de produccion real, esta logica se moveria a Cloud Functions para evitar exponer la configuracion de Firebase y para manejar archivos de mayor tamano.

**Parser XML flexible.** Se implemento soporte para multiples namespaces (CFDI 3.3 y 4.0) con fallback por localName, para no depender de una version especifica del estandar.

**Mapeo de columnas CSV tolerante a variaciones.** El sistema normaliza encabezados (minusculas, sin acentos) para evitar fallos cuando el archivo usa variaciones tipograficas en los nombres de columna.

**Tiempo real en modulo 3.** Se usa `onSnapshot` de Firestore para que los cambios de estado sean visibles sin necesidad de recargar la pagina, lo que facilita el uso en entornos con multiples usuarios.

**Soft delete.** Los registros eliminados se marcan con `eliminadoLogico: true` en lugar de borrarse, preservando el historial de auditoria completo.

---

## Mejoras para produccion

- Autenticacion con Firebase Auth y reglas de seguridad en Firestore por usuario
- Paginacion en colecciones grandes mediante cursores de Firestore
- Pruebas unitarias con Vitest para los parsers de XML y CSV
- Variables de entorno mediante `import.meta.env` en lugar de valores directos
- Code splitting para reducir el tamano del bundle (actualmente ~860 KB)
- Pipeline de CI/CD con GitHub Actions para deploy automatico en push a main
- Contenedor Docker para reproducibilidad del entorno de desarrollo
