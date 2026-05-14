import React, { useState, useCallback } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { db } from '../lib/firebase';
import { collection, addDoc, Timestamp } from 'firebase/firestore';

// ── Types ──
interface Row {
  folio: string;
  fecha: string;
  categoria: string;
  monto: number;
  estatus: string;
  _rowNum: number;
  _error?: string;
}

interface RowError {
  row: number;
  msg: string;
}

interface Summary {
  total: number;
  sumaMonto: number;
  porEstatus: Record<string, number>;
  porCategoria: Record<string, { count: number; suma: number }>;
  duplicados: string[];
  errores: RowError[];
}

const REQUIRED_COLS = ['folio', 'fecha', 'categoria', 'monto', 'estatus'];

// ── Helpers ──
function normalizeHeader(h: string): string {
  return h.toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isValidDate(d: string): boolean {
  if (!d) return false;
  const iso   = /^\d{4}-\d{2}-\d{2}/.test(d);
  const slash = /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(d);
  return iso || slash || !isNaN(Date.parse(d));
}

function parseRows(rawRows: Record<string, string>[], headerMap: Record<string, string>): {
  rows: Row[]; errors: RowError[];
} {
  const rows: Row[] = [];
  const errors: RowError[] = [];

  rawRows.forEach((raw, idx) => {
    const rowNum   = idx + 2;
    const folio    = (raw[headerMap['folio']]     || '').toString().trim();
    const fecha    = (raw[headerMap['fecha']]     || '').toString().trim();
    const categoria = (raw[headerMap['categoria']] || '').toString().trim();
    const montoRaw = (raw[headerMap['monto']]     || '').toString().trim();
    const estatus  = (raw[headerMap['estatus']]   || '').toString().trim();

    const rowErrs: string[] = [];
    if (!folio)    rowErrs.push('Folio vacio');
    if (!fecha)    rowErrs.push('Fecha vacia');
    else if (!isValidDate(fecha)) rowErrs.push(`Fecha invalida: "${fecha}"`);
    if (!categoria) rowErrs.push('Categoria vacia');
    if (!estatus)  rowErrs.push('Estatus vacio');

    const monto = parseFloat(montoRaw.replace(/[$,\s]/g, ''));
    if (montoRaw === '')   rowErrs.push('Monto vacio');
    else if (isNaN(monto)) rowErrs.push(`Monto invalido: "${montoRaw}"`);

    if (rowErrs.length > 0) errors.push({ row: rowNum, msg: rowErrs.join('; ') });

    const row: Row = {
      folio, fecha, categoria,
      monto: isNaN(monto) ? 0 : monto,
      estatus, _rowNum: rowNum
    };
    if (rowErrs.length > 0) row._error = rowErrs.join('; ');
    rows.push(row);
  });

  return { rows, errors };
}

function buildSummary(rows: Row[], errors: RowError[]): Summary {
  const folioCount: Record<string, number>  = {};
  const porEstatus: Record<string, number>  = {};
  const porCategoria: Record<string, { count: number; suma: number }> = {};
  let sumaMonto = 0;

  rows.forEach(r => {
    if (!r._error) {
      sumaMonto += r.monto;
      porEstatus[r.estatus] = (porEstatus[r.estatus] || 0) + 1;
      if (!porCategoria[r.categoria]) porCategoria[r.categoria] = { count: 0, suma: 0 };
      porCategoria[r.categoria].count++;
      porCategoria[r.categoria].suma += r.monto;
    }
    if (r.folio) folioCount[r.folio] = (folioCount[r.folio] || 0) + 1;
  });

  const duplicados = Object.entries(folioCount).filter(([, c]) => c > 1).map(([f]) => f);
  return { total: rows.length, sumaMonto, porEstatus, porCategoria, duplicados, errores: errors };
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

function estatusBadge(s: string) {
  const sl = s.toLowerCase();
  if (sl.includes('pag') || sl.includes('apro') || sl.includes('activ') || sl.includes('complet'))
    return <span className="badge badge-green">{s}</span>;
  if (sl.includes('cancel') || sl.includes('rechaz') || sl.includes('inac'))
    return <span className="badge badge-red">{s}</span>;
  if (sl.includes('pend') || sl.includes('proce'))
    return <span className="badge badge-yellow">{s}</span>;
  return <span className="badge badge-gray">{s}</span>;
}

// ── SVG Icons ──
const IconUpload = () => (
  <svg viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
  </svg>
);
const IconCheck = () => (
  <svg viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
  </svg>
);
const IconX = () => (
  <svg viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
  </svg>
);
const IconWarn = () => (
  <svg viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
  </svg>
);
const IconDoc = () => (
  <svg viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/>
  </svg>
);

// ── Component ──
export default function CSVAnalyzer() {
  const [dragging,     setDragging]     = useState(false);
  const [fileName,     setFileName]     = useState('');
  const [fileSize,     setFileSize]     = useState(0);
  const [rows,         setRows]         = useState<Row[]>([]);
  const [rowErrors,    setRowErrors]    = useState<RowError[]>([]);
  const [summary,      setSummary]      = useState<Summary | null>(null);
  const [globalError,  setGlobalError]  = useState('');
  const [filter,       setFilter]       = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState('');
  const [activeView,   setActiveView]   = useState<'table' | 'summary'>('summary');

  const processFile = useCallback((file: File) => {
    setGlobalError(''); setRows([]); setRowErrors([]);
    setSummary(null); setSaveMsg('');
    setFileName(file.name); setFileSize(file.size);

    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'csv') {
      Papa.parse<Record<string, string>>(file, {
        header: true, skipEmptyLines: true,
        complete: (result) => handleParsed(result.data, result.meta.fields || []),
        error: (err) => setGlobalError('Error al leer CSV: ' + err.message)
      });
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: 'binary' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { raw: false, defval: '' });
          handleParsed(data, Object.keys(data[0] || {}));
        } catch (err) {
          setGlobalError('Error al leer Excel: ' + String(err));
        }
      };
      reader.readAsBinaryString(file);
    } else {
      setGlobalError('Formato no soportado. Utilice archivos CSV, XLS o XLSX.');
    }
  }, []);

  function handleParsed(data: Record<string, string>[], fields: string[]) {
    if (data.length === 0) {
      setGlobalError('El archivo esta vacio o no contiene registros validos.');
      return;
    }

    const headerMap: Record<string, string> = {};
    const normalizedFields = fields.map(f => ({ orig: f, norm: normalizeHeader(f) }));

    for (const col of REQUIRED_COLS) {
      const found = normalizedFields.find(f => f.norm === col || f.norm.includes(col));
      if (found) headerMap[col] = found.orig;
    }

    const missing = REQUIRED_COLS.filter(c => !headerMap[c]);
    if (missing.length > 0) {
      setGlobalError(
        `Columnas faltantes: ${missing.join(', ')}. ` +
        `Columnas detectadas en el archivo: ${fields.join(', ')}`
      );
      return;
    }

    const { rows: parsed, errors } = parseRows(data, headerMap);
    const sum = buildSummary(parsed, errors);
    setRows(parsed);
    setRowErrors(errors);
    setSummary(sum);
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleSave = async () => {
    if (!summary) return;
    setSaving(true); setSaveMsg('');
    try {
      const validRows = rows.filter(r => !r._error);
      await addDoc(collection(db, 'csv_analisis'), {
        archivo: fileName, totalRegistros: summary.total,
        sumaMonto: summary.sumaMonto, porEstatus: summary.porEstatus,
        porCategoria: summary.porCategoria, duplicados: summary.duplicados,
        errores: summary.errores.length, guardadoEn: Timestamp.now(),
        registros: validRows.map(({ _rowNum, _error, ...rest }) => rest)
      });
      setSaveMsg('ok:Analisis guardado en la base de datos correctamente.');
    } catch (err) {
      setSaveMsg('err:Error al guardar: ' + String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setRows([]); setRowErrors([]); setSummary(null);
    setGlobalError(''); setFileName(''); setFileSize(0);
    setSaveMsg(''); setFilter(''); setFilterStatus('');
  };

  const exportCSV = () => {
    const validRows = rows.filter(r => !r._error);
    const csv = Papa.unparse(validRows.map(({ _rowNum, _error, ...rest }) => rest));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'resultado_analisis.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const filteredRows = rows.filter(r => {
    const matchText   = !filter       || r.folio.toLowerCase().includes(filter.toLowerCase()) || r.categoria.toLowerCase().includes(filter.toLowerCase());
    const matchStatus = !filterStatus || r.estatus === filterStatus;
    return matchText && matchStatus;
  });

  const statuses = [...new Set(rows.map(r => r.estatus).filter(Boolean))];

  const [saveMsgType, saveMsgText] = saveMsg.includes(':')
    ? [saveMsg.split(':')[0], saveMsg.slice(saveMsg.indexOf(':') + 1)]
    : ['', saveMsg];

  return (
    <div className="fade-in">
      <div className="section-header">
        <h2>Importacion y Analisis de Archivos Excel / CSV</h2>
        <p>
          Carga un archivo Excel (.xlsx) o CSV con las columnas requeridas: Folio, Fecha, Categoria,
          Monto, Estatus. El sistema valida cada registro, detecta duplicados y genera un resumen
          agrupado por estatus y categoria.
        </p>
      </div>

      {/* Upload */}
      {!summary && (
        <div className="card">
          <div className="card-title"><span className="card-title-bar" />Cargar archivo</div>
          <div
            className={`upload-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
            <div className="upload-icon"><IconUpload /></div>
            <h3>Seleccionar archivo</h3>
            <p>Arrastre el archivo aqui o haga clic para buscar</p>
            <div className="file-types">
              <span className="file-type-pill">CSV</span>
              <span className="file-type-pill">XLSX</span>
              <span className="file-type-pill">XLS</span>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <div className="card-title"><span className="card-title-bar" />Estructura esperada del archivo</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Folio</th><th>Fecha</th><th>Categoria</th><th>Monto</th><th>Estatus</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td>F-001</td><td>2024-01-15</td><td>Servicios</td><td>1500.00</td><td>Pagado</td></tr>
                  <tr><td>F-002</td><td>2024-01-16</td><td>Productos</td><td>3200.50</td><td>Pendiente</td></tr>
                  <tr><td>F-003</td><td>2024-01-17</td><td>Servicios</td><td>800.00</td><td>Cancelado</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* File bar */}
      {fileName && (
        <div className="file-bar">
          <IconDoc />
          <span className="file-bar-name">{fileName}</span>
          <span className="file-bar-meta">{(fileSize / 1024).toFixed(1)} KB</span>
          {summary && <button className="btn btn-secondary btn-sm" onClick={handleReset}>Limpiar</button>}
        </div>
      )}

      {/* Global error */}
      {globalError && (
        <div className="alert alert-error">
          <span className="alert-icon"><IconX /></span>
          <span>{globalError}</span>
        </div>
      )}

      {/* Save message */}
      {saveMsg && (
        <div className={`alert ${saveMsgType === 'ok' ? 'alert-success' : 'alert-error'}`}>
          <span className="alert-icon">{saveMsgType === 'ok' ? <IconCheck /> : <IconX />}</span>
          <span>{saveMsgText}</span>
        </div>
      )}

      {/* Results */}
      {summary && (
        <>
          {/* Stats */}
          <div className="stats-grid">
            <div className="stat-card blue">
              <div className="stat-label">Total de registros</div>
              <div className="stat-value">{summary.total}</div>
            </div>
            <div className="stat-card green">
              <div className="stat-label">Suma de montos</div>
              <div className="stat-value" style={{ fontSize: '1rem', lineHeight: 1.4 }}>{fmtMoney(summary.sumaMonto)}</div>
            </div>
            <div className="stat-card red">
              <div className="stat-label">Registros con error</div>
              <div className="stat-value">{summary.errores.length}</div>
            </div>
            <div className="stat-card gray">
              <div className="stat-label">Folios duplicados</div>
              <div className="stat-value">{summary.duplicados.length}</div>
            </div>
          </div>

          {/* Duplicates */}
          {summary.duplicados.length > 0 && (
            <div className="alert alert-warning">
              <span className="alert-icon"><IconWarn /></span>
              <div>
                <strong>Folios duplicados detectados:</strong>
                <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {summary.duplicados.map(d => (
                    <span key={d} className="badge badge-yellow">{d}</span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Row errors */}
          {rowErrors.length > 0 && (
            <div className="alert alert-error">
              <span className="alert-icon"><IconX /></span>
              <div>
                <strong>{rowErrors.length} fila(s) con errores de validacion:</strong>
                <ul style={{ marginTop: 6 }}>
                  {rowErrors.map((e, i) => <li key={i}>Fila {e.row}: {e.msg}</li>)}
                </ul>
              </div>
            </div>
          )}

          {/* View toggle */}
          <div className="toolbar" style={{ marginBottom: 16 }}>
            <button
              className={`btn ${activeView === 'summary' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveView('summary')}
            >
              Resumen
            </button>
            <button
              className={`btn ${activeView === 'table' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveView('table')}
            >
              Registros ({filteredRows.length})
            </button>
            <button className="btn btn-secondary btn-sm" onClick={exportCSV}>Exportar CSV</button>
            <button className="btn btn-success btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? <><span className="spinner" /> Guardando…</> : 'Guardar en base de datos'}
            </button>
            <button className="btn btn-danger btn-sm" onClick={handleReset}>Limpiar</button>
          </div>

          {/* Summary view */}
          {activeView === 'summary' && (
            <div className="grid-2">
              <div className="card">
                <div className="card-title"><span className="card-title-bar" />Agrupacion por estatus</div>
                {Object.entries(summary.porEstatus).length === 0 ? (
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Sin datos validos.</p>
                ) : (
                  Object.entries(summary.porEstatus).map(([est, cnt]) => (
                    <div key={est} className="summary-row">
                      {estatusBadge(est)}
                      <span className="summary-val">{cnt} registro(s)</span>
                    </div>
                  ))
                )}
              </div>
              <div className="card">
                <div className="card-title"><span className="card-title-bar" />Agrupacion por categoria</div>
                {Object.entries(summary.porCategoria).map(([cat, info]) => (
                  <div key={cat} className="summary-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span style={{ fontWeight: 600, color: 'var(--gray-900)', fontSize: '0.82rem' }}>{cat}</span>
                      <span className="badge badge-blue">{info.count} reg.</span>
                    </div>
                    <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                      Total acumulado: {fmtMoney(info.suma)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Table view */}
          {activeView === 'table' && (
            <div className="card">
              <div className="toolbar" style={{ marginBottom: 14 }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Buscar por folio o categoria..."
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  style={{ maxWidth: 260 }}
                />
                <select
                  className="form-select"
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  style={{ maxWidth: 200 }}
                >
                  <option value="">Todos los estatus</option>
                  {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Fila</th>
                      <th>Folio</th>
                      <th>Fecha</th>
                      <th>Categoria</th>
                      <th>Monto</th>
                      <th>Estatus</th>
                      <th>Validacion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map(r => (
                      <tr key={r._rowNum} style={r._error ? { background: 'var(--red-50)' } : {}}>
                        <td>{r._rowNum}</td>
                        <td><strong>{r.folio}</strong></td>
                        <td>{r.fecha}</td>
                        <td>{r.categoria}</td>
                        <td style={{ fontWeight: 600, color: 'var(--green-700)' }}>{fmtMoney(r.monto)}</td>
                        <td>{estatusBadge(r.estatus)}</td>
                        <td>
                          {r._error
                            ? <span className="badge badge-red" title={r._error}>Error</span>
                            : <span className="badge badge-green">OK</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
