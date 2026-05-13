# Prueba Técnica — Integra Grupo Alerta

Aplicación web desarrollada como prueba técnica para la vacante de **Desarrollador Jr.** en Integra TI.

## 🚀 Demo en vivo

> Desplegado en Firebase Hosting: [https://grupoalerta-9ddf1.web.app](https://grupoalerta-9ddf1.web.app)

---

## 📋 Descripción

Aplicación React con **3 módulos funcionales** presentados como pestañas:

| # | Módulo | Opción |
|---|--------|--------|
| 01 | **Procesador XML (CFDI)** | Opción 1 |
| 02 | **Análisis CSV / Excel** | Opción 2 |
| 03 | **Registros con Historial** | Opción 3 |

---

## 🧩 Funcionalidades por módulo

### 01 — Procesador XML (CFDI)
- ✅ Carga de archivo XML (drag & drop o click)
- ✅ Soporte CFDI 3.3 y 4.0 con namespaces
- ✅ Extracción de: Folio, Fecha, Emisor, Receptor, Total, SubTotal, Moneda, Conceptos
- ✅ Validaciones: XML inválido, archivo vacío, nodos faltantes, Total no numérico
- ✅ Guardar en Firestore con verificación de duplicados por folio
- ✅ Visualización del XML raw

### 02 — Análisis CSV / Excel
- ✅ Carga de archivos `.csv`, `.xlsx`, `.xls`
- ✅ Mapeo automático de columnas (case-insensitive, ignora acentos)
- ✅ Validaciones por fila: campos vacíos, montos inválidos, fechas mal formateadas
- ✅ Detección de folios duplicados
- ✅ Resumen: total de registros, suma de montos, agrupación por estatus y categoría
- ✅ Filtros por texto y estatus
- ✅ Exportar resultados a CSV
- ✅ Guardar análisis en Firestore

### 03 — Registros con Historial de Cambios
- ✅ Crear registros (con validación de folio único)
- ✅ Listar registros con filtros
- ✅ Actualizar estado con motivo obligatorio
- ✅ Historial automático en creación y actualización
- ✅ Eliminación lógica (soft delete) con evento en historial
- ✅ Panel de detalle con timeline de eventos por registro
- ✅ Historial global paginado
- ✅ Actualizaciones en tiempo real (Firestore `onSnapshot`)

---

## 🛠️ Tecnologías

- **React 18** + **TypeScript**
- **Vite** (bundler)
- **Firebase** (Firestore + Hosting)
- **PapaParse** — parsing de CSV
- **SheetJS (xlsx)** — parsing de Excel
- CSS vanilla con diseño dark mode premium

---

## ⚙️ Instrucciones para ejecutar

### Prerequisitos
- Node.js >= 18
- npm >= 9

### 1. Clonar e instalar
```bash
git clone <repo-url>
cd "grupo alerta"
npm install
```

### 2. Variables de entorno (opcional)
El proyecto incluye la config de Firebase directamente, pero puedes usar variables de entorno:
```bash
cp .env.example .env
# Edita .env con tus valores de Firebase
```

### 3. Ejecutar en desarrollo
```bash
npm run dev
```
Abre [http://localhost:5173](http://localhost:5173)

### 4. Build de producción
```bash
npm run build
```

### 5. Desplegar a Firebase
```bash
npm install -g firebase-tools
firebase login
npm run build
firebase deploy
```

---

## 🏗️ Estructura del proyecto

```
src/
├── components/
│   ├── XMLProcessor.tsx    # Módulo 1: Parser XML CFDI
│   ├── CSVAnalyzer.tsx     # Módulo 2: Análisis CSV/Excel
│   └── RecordsHistory.tsx  # Módulo 3: Registros + Historial
├── lib/
│   └── firebase.ts         # Inicialización Firebase
├── App.tsx                 # Shell con navegación por pestañas
├── main.tsx                # Entry point
└── index.css               # Design system CSS
```

---

## 🗄️ Colecciones Firestore

| Colección | Descripción |
|-----------|-------------|
| `xml_documentos` | CFDIs procesados y guardados |
| `csv_analisis` | Resultados de análisis CSV/Excel |
| `registros` | Entidad principal (Módulo 3) |
| `historial` | Eventos de cambio por registro |

---

## 🔐 Seguridad

- Variables de entorno con `.env.example`
- Firestore rules deben configurarse en producción para auth
- No se exponen claves secretas en el código (solo config pública de Firebase)

---

## 🚀 Qué mejoraría para producción

1. **Autenticación**: Firebase Auth para proteger las rutas y asociar datos a usuarios
2. **Firestore Security Rules**: Reglas estrictas por usuario autenticado
3. **Variables de entorno reales**: Usar `import.meta.env` en lugar de hardcodear la config
4. **Paginación**: Para colecciones grandes en Firestore (cursor-based pagination)
5. **Pruebas unitarias**: Vitest + Testing Library para los parsers XML y CSV
6. **Docker**: Containerizar el servidor de desarrollo para reproducibilidad
7. **CI/CD**: GitHub Actions para deploy automático a Firebase en cada push a main
8. **Swagger/OpenAPI**: Si se extrae la lógica a Cloud Functions, documentar los endpoints
9. **Error logging**: Integrar Sentry o Firebase Crashlytics
10. **Optimistic updates**: Para mejor UX en el módulo 3

---

## 👤 Decisiones técnicas

- **Sin backend separado**: La lógica de procesamiento corre en el cliente. Para producción se extraería a Cloud Functions para mayor seguridad y escala.
- **Soporte CFDI 3.3 y 4.0**: El parser XML maneja múltiples namespaces y hace fallback a búsqueda por localName.
- **Mapeo flexible de columnas CSV**: Normaliza acentos y mayúsculas para evitar fallos por diferencias tipográficas.
- **Real-time en módulo 3**: Se usa `onSnapshot` para que múltiples usuarios vean cambios sin recargar.
- **Soft delete**: Los registros eliminados se marcan como `eliminadoLogico: true` para conservar el historial de auditoría.

---

*Desarrollado para la Prueba Técnica de Integra Grupo Alerta — Mayo 2026*
