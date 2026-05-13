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
  // Acepta varios formatos
  const iso = /^\d{4}-\d{2}-\d{2}/.test(d);
  const slash = /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(d);
  return iso || slash || !isNaN(Date.parse(d));
}

function parseRows(rawRows: Record<string, string>[], headerMap: Record<string, string>): {
  rows: Row[]; errors: RowError[];
} {
  const rows: Row[] = [];
  const errors: RowError[] = [];
  const foliosSeen = new Set<string>();

  rawRows.forEach((raw, idx) => {
    const rowNum = idx + 2; // +2 por header y 0-index
    const folio = (raw[headerMap['folio']] || '').toString().trim();
    const fecha = (raw[headerMap['fecha']] || '').toString().trim();
    const categoria = (raw[headerMap['categoria']] || '').toString().trim();
    const montoRaw = (raw[headerMap['monto']] || '').toString().trim();
    const estatus = (raw[headerMap['estatus']] || '').toString().trim();

    const rowErrors: string[] = [];

    if (!folio) rowErrors.push('Folio vacío');
    if (!fecha) rowErrors.push('Fecha vacía');
    else if (!isValidDate(fecha)) rowErrors.push(`Fecha inválida: "${fecha}"`);
    if (!categoria) rowErrors.push('Categoría vacía');
    if (!estatus) rowErrors.push('Estatus vacío');

    const monto = parseFloat(montoRaw.replace(/[$,\s]/g, ''));
    if (montoRaw === '') rowErrors.push('Monto vacío');
    else if (isNaN(monto)) rowErrors.push(`Monto inválido: "${montoRaw}"`);

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, msg: rowErrors.join('; ') });
    }

    const row: Row = { folio, fecha, categoria, monto: isNaN(monto) ? 0 : monto, estatus, _rowNum: rowNum };
    if (rowErrors.length > 0) row._error = rowErrors.join('; ');
    rows.push(row);
    foliosSeen.add(folio);
  });

  return { rows, errors };
}

function buildSummary(rows: Row[]): Summary {
  const folioCount: Record<string, number> = {};
  const porEstatus: Record<string, number> = {};
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
  const validRows = rows.filter(r => !r._error);

  return { total: rows.length, sumaMonto, porEstatus, porCategoria, duplicados, errores: [] };
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

// ── Status badge ──
function statusBadge(s: string) {
  const sl = s.toLowerCase();
  if (sl.includes('pag') || sl.includes('apro') || sl.includes('activ')) return <span className="badge badge-green">{s}</span>;
  if (sl.includes('cancel') || sl.includes('rechaz') || sl.includes('inac')) return <span className="badge badge-red">{s}</span>;
  if (sl.includes('pend') || sl.includes('proce')) return <span className="badge badge-yellow">{s}</span>;
  return <span className="badge badge-gray">{s}</span>;
}

// ── Component ──
export default function CSVAnalyzer() {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [globalError, setGlobalError] = useState('');
  const [filter, setFilter] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [activeView, setActiveView] = useState<'table' | 'summary'>('summary');

  const processFile = useCallback((file: File) => {
    setGlobalError('');
    setRows([]);
    setRowErrors([]);
    setSummary(null);
    setSaveMsg('');
    setFileName(file.name);
    setFileSize(file.size);

    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'csv') {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          handleParsed(result.data, result.meta.fields || []);
        },
        error: (err) => setGlobalError('Error al leer CSV: ' + err.message)
      });
    } else if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: 'binary' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { raw: false, defval: '' });
          const fields = Object.keys(data[0] || {});
          handleParsed(data, fields);
        } catch (err) {
          setGlobalError('Error al leer Excel: ' + String(err));
        }
      };
      reader.readAsBinaryString(file);
    } else {
      setGlobalError('Formato no soportado. Solo CSV, XLS o XLSX.');
    }
  }, []);

  function handleParsed(data: Record<string, string>[], fields: string[]) {
    if (data.length === 0) {
      setGlobalError('El archivo está vacío o no contiene registros.');
      return;
    }

    // Map headers (case-insensitive, normalize accents)
    const headerMap: Record<string, string> = {};
    const normalizedFields = fields.map(f => ({ orig: f, norm: normalizeHeader(f) }));

    for (const col of REQUIRED_COLS) {
      const found = normalizedFields.find(f => f.norm === col || f.norm.includes(col));
      if (found) headerMap[col] = found.orig;
    }

    const missing = REQUIRED_COLS.filter(c => !headerMap[c]);
    if (missing.length > 0) {
      setGlobalError(`Columnas faltantes: ${missing.join(', ')}. Columnas encontradas: ${fields.join(', ')}`);
      return;
    }

    const { rows: parsed, errors } = parseRows(data, headerMap);
    const sum = buildSummary(parsed);
    setRows(parsed);
    setRowErrors(errors);
    setSummary({ ...sum, errores: errors });
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleSave = async () => {
    if (!summary) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const validRows = rows.filter(r => !r._error);
      await addDoc(collection(db, 'csv_analisis'), {
        archivo: fileName,
        totalRegistros: summary.total,
        sumaMonto: summary.sumaMonto,
        porEstatus: summary.porEstatus,
        porCategoria: summary.porCategoria,
        duplicados: summary.duplicados,
        errores: summary.errores.length,
        guardadoEn: Timestamp.now(),
        registros: validRows.map(({ _rowNum, _error, ...rest }) => rest)
      });
      setSaveMsg('✅ Análisis guardado en Firestore.');
    } catch (err) {
      setSaveMsg('❌ Error: ' + String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setRows([]);
    setRowErrors([]);
    setSummary(null);
    setGlobalError('');
    setFileName('');
    setFileSize(0);
    setSaveMsg('');
    setFilter('');
    setFilterStatus('');
  };

  const filteredRows = rows.filter(r => {
    const matchText = !filter || r.folio.toLowerCase().includes(filter.toLowerCase()) || r.categoria.toLowerCase().includes(filter.toLowerCase());
    const matchStatus = !filterStatus || r.estatus === filterStatus;
    return matchText && matchStatus;
  });

  const statuses = [...new Set(rows.map(r => r.estatus).filter(Boolean))];

  const exportCSV = () => {
    const validRows = rows.filter(r => !r._error);
    const csv = Papa.unparse(validRows.map(({ _rowNum, _error, ...rest }) => rest));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resultado_analisis.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fade-in">
      <div className="section-header">
        <h2>📊 Importación y Análisis de Excel / CSV</h2>
        <p>Carga un archivo Excel (.xlsx) o CSV con columnas: Folio, Fecha, Categoría, Monto, Estatus. Se generan resúmenes, validaciones y agrupaciones automáticas.</p>
      </div>

      {/* Upload */}
      {!summary && (
        <div className="card">
          <div className="card-title"><span className="dot"></span>Cargar archivo</div>
          <div
            className={`upload-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFileChange} />
            <div className="upload-icon">📊</div>
            <h3>Arrastra tu archivo aquí o haz clic para seleccionar</h3>
            <p>El archivo debe incluir: Folio, Fecha, Categoría, Monto, Estatus</p>
            <div className="file-types">
              <span className="file-type-badge">CSV</span>
              <span className="file-type-badge">XLSX</span>
              <span className="file-type-badge">XLS</span>
            </div>
          </div>

          {/* Demo hint */}
          <div style={{ marginTop: 20 }}>
            <div className="card-title" style={{ marginBottom: 8 }}><span className="dot" style={{ background: '#f59e0b' }}></span>💡 Estructura esperada del archivo</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Folio</th><th>Fecha</th><th>Categoría</th><th>Monto</th><th>Estatus</th></tr></thead>
                <tbody>
                  <tr><td>001</td><td>2024-01-15</td><td>Servicios</td><td>1500.00</td><td>Pagado</td></tr>
                  <tr><td>002</td><td>2024-01-16</td><td>Productos</td><td>3200.50</td><td>Pendiente</td></tr>
                  <tr><td>003</td><td>2024-01-17</td><td>Servicios</td><td>800.00</td><td>Cancelado</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* File info */}
      {fileName && (
        <div className="file-info-bar">
          <span className="file-icon">📎</span>
          <span className="file-name">{fileName}</span>
          <span className="file-meta">{(fileSize / 1024).toFixed(1)} KB</span>
          {summary && <button className="btn btn-sm btn-secondary" onClick={handleReset}>✕ Limpiar</button>}
        </div>
      )}

      {/* Global error */}
      {globalError && (
        <div className="alert alert-error">
          <span className="alert-icon">❌</span>
          <span>{globalError}</span>
        </div>
      )}

      {/* Save msg */}
      {saveMsg && (
        <div className={`alert ${saveMsg.startsWith('✅') ? 'alert-success' : 'alert-error'}`}>
          <span className="alert-icon">{saveMsg.startsWith('✅') ? '✅' : '❌'}</span>
          <span>{saveMsg}</span>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <>
          {/* Stats */}
          <div className="stats-grid">
            <div className="stat-card blue">
              <div className="stat-label">Total Registros</div>
              <div className="stat-value">{summary.total}</div>
            </div>
            <div className="stat-card green">
              <div className="stat-label">Suma de Montos</div>
              <div className="stat-value" style={{ fontSize: '1.1rem' }}>{fmtMoney(summary.sumaMonto)}</div>
            </div>
            <div className="stat-card yellow">
              <div className="stat-label">Con Errores</div>
              <div className="stat-value">{summary.errores.length}</div>
            </div>
            <div className="stat-card red">
              <div className="stat-label">Duplicados</div>
              <div className="stat-value">{summary.duplicados.length}</div>
            </div>
          </div>

          {/* Duplicates warning */}
          {summary.duplicados.length > 0 && (
            <div className="alert alert-warning">
              <span className="alert-icon">⚠️</span>
              <div>
                <strong>Folios duplicados detectados:</strong>
                <div className="chips" style={{ marginTop: 6 }}>
                  {summary.duplicados.map(d => <span key={d} className="badge badge-yellow">{d}</span>)}
                </div>
              </div>
            </div>
          )}

          {/* Row errors */}
          {rowErrors.length > 0 && (
            <div className="alert alert-error">
              <span className="alert-icon">❌</span>
              <div>
                <strong>{rowErrors.length} fila(s) con errores:</strong>
                <ul style={{ marginTop: 6 }}>
                  {rowErrors.map((e, i) => <li key={i}>Fila {e.row}: {e.msg}</li>)}
                </ul>
              </div>
            </div>
          )}

          {/* View tabs */}
          <div className="toolbar" style={{ marginBottom: 16 }}>
            <button className={`btn ${activeView === 'summary' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveView('summary')}>
              📈 Resumen
            </button>
            <button className={`btn ${activeView === 'table' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setActiveView('table')}>
              📋 Registros ({filteredRows.length})
            </button>
            <button className="btn btn-success btn-sm" onClick={exportCSV}>⬇️ Exportar CSV</button>
            <button className="btn btn-secondary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? <span className="loading-spinner"></span> : '💾 Guardar en Firestore'}
            </button>
            <button className="btn btn-danger btn-sm" onClick={handleReset}>🗑️ Limpiar</button>
          </div>

          {/* Summary View */}
          {activeView === 'summary' && (
            <div className="grid-2">
              <div className="card">
                <div className="card-title"><span className="dot" style={{ background: '#10b981' }}></span>Por Estatus</div>
                {Object.entries(summary.porEstatus).map(([est, cnt]) => (
                  <div key={est} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    {statusBadge(est)}
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{cnt} reg.</span>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="card-title"><span className="dot" style={{ background: '#8b5cf6' }}></span>Por Categoría</div>
                {Object.entries(summary.porCategoria).map(([cat, info]) => (
                  <div key={cat} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{cat}</span>
                      <span className="badge badge-purple">{info.count} reg.</span>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>Total: {fmtMoney(info.suma)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Table View */}
          {activeView === 'table' && (
            <div className="card">
              <div className="toolbar" style={{ marginBottom: 12 }}>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Buscar por folio o categoría..."
                  value={filter}
                  onChange={e => setFilter(e.target.value)}
                  style={{ maxWidth: 260 }}
                />
                <select className="form-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ maxWidth: 180 }}>
                  <option value="">Todos los estatus</option>
                  {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Folio</th>
                      <th>Fecha</th>
                      <th>Categoría</th>
                      <th>Monto</th>
                      <th>Estatus</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((r) => (
                      <tr key={r._rowNum} style={r._error ? { background: 'rgba(239,68,68,0.05)' } : {}}>
                        <td>{r._rowNum}</td>
                        <td><strong>{r.folio}</strong></td>
                        <td>{r.fecha}</td>
                        <td>{r.categoria}</td>
                        <td style={{ color: '#6ee7b7', fontWeight: 600 }}>{fmtMoney(r.monto)}</td>
                        <td>{statusBadge(r.estatus)}</td>
                        <td>
                          {r._error
                            ? <span className="badge badge-red" title={r._error}>❌ Error</span>
                            : <span className="badge badge-green">✓ OK</span>}
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
