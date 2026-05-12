import React, { useState, useCallback } from 'react';
import { db } from '../lib/firebase';
import {
  collection, addDoc, query, where, getDocs, Timestamp
} from 'firebase/firestore';

// ── Types ──
interface Concepto {
  descripcion: string;
  cantidad: number;
  valorUnitario: number;
  importe: number;
  claveUnidad?: string;
}

interface CFDIData {
  folio: string;
  fecha: string;
  emisor: { nombre: string; rfc: string; regimenFiscal?: string };
  receptor: { nombre: string; rfc: string; usoCFDI?: string };
  total: number;
  subTotal?: number;
  moneda?: string;
  conceptos: Concepto[];
  rawXML: string;
}

interface ValidationError {
  type: 'error' | 'warning';
  message: string;
}

// ── Helpers ──
function parseXML(xmlText: string): { data: CFDIData | null; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  if (!xmlText || xmlText.trim().length === 0) {
    errors.push({ type: 'error', message: 'El archivo XML está vacío.' });
    return { data: null, errors };
  }

  let doc: Document;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(xmlText, 'application/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      errors.push({ type: 'error', message: 'XML inválido: estructura incorrecta o malformada.' });
      return { data: null, errors };
    }
  } catch {
    errors.push({ type: 'error', message: 'Error al procesar el XML.' });
    return { data: null, errors };
  }

  // Soporte CFDI 3.3 y 4.0 (con o sin namespace)
  const ns = [
    'http://www.sat.gob.mx/cfd/4',
    'http://www.sat.gob.mx/cfd/3',
    ''
  ];

  const getEl = (tag: string): Element | null => {
    for (const n of ns) {
      const el = n
        ? doc.getElementsByTagNameNS(n, tag)[0]
        : doc.getElementsByTagName(tag)[0];
      if (el) return el;
    }
    // Fallback: buscar por nombre local
    const all = Array.from(doc.getElementsByTagName('*'));
    return all.find(e => e.localName === tag) || null;
  };

  const comprobante = getEl('Comprobante');
  if (!comprobante) {
    errors.push({ type: 'error', message: 'Nodo raíz <Comprobante> no encontrado.' });
    return { data: null, errors };
  }

  const folio = comprobante.getAttribute('Folio') || comprobante.getAttribute('folio') || '';
  const fecha = comprobante.getAttribute('Fecha') || comprobante.getAttribute('fecha') || '';
  const totalStr = comprobante.getAttribute('Total') || comprobante.getAttribute('total') || '';
  const subTotalStr = comprobante.getAttribute('SubTotal') || '';
  const moneda = comprobante.getAttribute('Moneda') || '';

  if (!folio) errors.push({ type: 'warning', message: 'Atributo Folio no encontrado.' });
  if (!fecha) errors.push({ type: 'error', message: 'Atributo Fecha no encontrado.' });
  if (!totalStr) errors.push({ type: 'error', message: 'Atributo Total no encontrado.' });

  const total = parseFloat(totalStr);
  if (isNaN(total)) errors.push({ type: 'error', message: 'El Total no es un número válido.' });

  const emisorEl = getEl('Emisor');
  if (!emisorEl) errors.push({ type: 'error', message: 'Nodo <Emisor> no encontrado.' });
  const emisor = {
    nombre: emisorEl?.getAttribute('Nombre') || emisorEl?.getAttribute('nombre') || '(sin nombre)',
    rfc: emisorEl?.getAttribute('Rfc') || emisorEl?.getAttribute('rfc') || '(sin RFC)',
    regimenFiscal: emisorEl?.getAttribute('RegimenFiscal') || ''
  };

  const receptorEl = getEl('Receptor');
  if (!receptorEl) errors.push({ type: 'error', message: 'Nodo <Receptor> no encontrado.' });
  const receptor = {
    nombre: receptorEl?.getAttribute('Nombre') || receptorEl?.getAttribute('nombre') || '(sin nombre)',
    rfc: receptorEl?.getAttribute('Rfc') || receptorEl?.getAttribute('rfc') || '(sin RFC)',
    usoCFDI: receptorEl?.getAttribute('UsoCFDI') || ''
  };

  const conceptosEl = getEl('Conceptos');
  if (!conceptosEl) errors.push({ type: 'warning', message: 'Nodo <Conceptos> no encontrado.' });

  const conceptoEls = conceptosEl
    ? Array.from(conceptosEl.getElementsByTagName('*')).filter(e => e.localName === 'Concepto')
    : [];

  const conceptos: Concepto[] = conceptoEls.map(el => ({
    descripcion: el.getAttribute('Descripcion') || el.getAttribute('descripcion') || '',
    cantidad: parseFloat(el.getAttribute('Cantidad') || '0'),
    valorUnitario: parseFloat(el.getAttribute('ValorUnitario') || '0'),
    importe: parseFloat(el.getAttribute('Importe') || '0'),
    claveUnidad: el.getAttribute('ClaveUnidad') || ''
  }));

  if (errors.some(e => e.type === 'error')) {
    return { data: null, errors };
  }

  return {
    data: {
      folio,
      fecha,
      emisor,
      receptor,
      total: isNaN(total) ? 0 : total,
      subTotal: parseFloat(subTotalStr) || undefined,
      moneda,
      conceptos,
      rawXML: xmlText
    },
    errors
  };
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
}

// ── Component ──
export default function XMLProcessor() {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [data, setData] = useState<CFDIData | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [checkDupe, setCheckDupe] = useState(false);

  const processFile = useCallback(async (file: File) => {
    setErrors([]);
    setData(null);
    setSaveMsg('');
    setFileName(file.name);
    setFileSize(file.size);

    if (!file.name.toLowerCase().endsWith('.xml')) {
      setErrors([{ type: 'error', message: 'El archivo debe tener extensión .xml' }]);
      return;
    }

    const text = await file.text();
    const { data: parsed, errors: errs } = parseXML(text);
    setErrors(errs);
    setData(parsed);
  }, []);

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
    if (!data) return;
    setSaving(true);
    setSaveMsg('');
    try {
      if (checkDupe) {
        const q = query(collection(db, 'xml_documentos'), where('folio', '==', data.folio));
        const snap = await getDocs(q);
        if (!snap.empty) {
          setSaveMsg('⚠️ Ya existe un documento con el folio ' + data.folio);
          setSaving(false);
          return;
        }
      }
      await addDoc(collection(db, 'xml_documentos'), {
        folio: data.folio,
        fecha: data.fecha,
        emisor: data.emisor,
        receptor: data.receptor,
        total: data.total,
        subTotal: data.subTotal ?? null,
        moneda: data.moneda ?? '',
        conceptos: data.conceptos,
        archivoNombre: fileName,
        guardadoEn: Timestamp.now()
      });
      setSaveMsg('✅ Documento guardado en Firestore correctamente.');
    } catch (err) {
      setSaveMsg('❌ Error al guardar: ' + String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setData(null);
    setErrors([]);
    setFileName('');
    setFileSize(0);
    setSaveMsg('');
    setShowRaw(false);
  };

  const hasErrors = errors.some(e => e.type === 'error');
  const hasWarnings = errors.some(e => e.type === 'warning');

  return (
    <div className="fade-in">
      <div className="section-header">
        <h2>🗂️ Procesamiento de Archivo XML (CFDI)</h2>
        <p>Carga un archivo XML de tipo CFDI (SAT México). Se extrae Folio, Fecha, Emisor, Receptor, Total y Conceptos. Los datos pueden guardarse en Firestore evitando duplicados por folio.</p>
      </div>

      {/* Upload Zone */}
      {!data && (
        <div className="card">
          <div className="card-title"><span className="dot"></span>Cargar archivo XML</div>
          <div
            className={`upload-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input type="file" accept=".xml" onChange={handleFileChange} />
            <div className="upload-icon">📄</div>
            <h3>Arrastra tu XML aquí o haz clic para seleccionar</h3>
            <p>Compatible con CFDI 3.3 y 4.0</p>
            <div className="file-types">
              <span className="file-type-badge">XML</span>
              <span className="file-type-badge">CFDI</span>
              <span className="file-type-badge">SAT</span>
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
          <button className="btn btn-sm btn-secondary" onClick={handleReset}>✕ Limpiar</button>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className={`alert ${hasErrors ? 'alert-error' : 'alert-warning'}`}>
          <span className="alert-icon">{hasErrors ? '❌' : '⚠️'}</span>
          <div>
            <strong>{hasErrors ? 'Errores de validación:' : 'Advertencias:'}</strong>
            <ul>{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
          </div>
        </div>
      )}

      {/* Save success/error message */}
      {saveMsg && (
        <div className={`alert ${saveMsg.startsWith('✅') ? 'alert-success' : saveMsg.startsWith('⚠️') ? 'alert-warning' : 'alert-error'}`}>
          <span className="alert-icon">{saveMsg.startsWith('✅') ? '✅' : saveMsg.startsWith('⚠️') ? '⚠️' : '❌'}</span>
          <span>{saveMsg}</span>
        </div>
      )}

      {/* Warnings but data ok */}
      {data && hasWarnings && !hasErrors && (
        <div className="alert alert-warning">
          <span className="alert-icon">⚠️</span>
          <div><strong>Procesado con advertencias:</strong><ul>{errors.filter(e => e.type === 'warning').map((e, i) => <li key={i}>{e.message}</li>)}</ul></div>
        </div>
      )}

      {/* Data Result */}
      {data && (
        <>
          <div className="alert alert-success" style={{ marginBottom: 20 }}>
            <span className="alert-icon">✅</span>
            <span>XML procesado correctamente. Se encontraron <strong>{data.conceptos.length}</strong> concepto(s).</span>
          </div>

          {/* Stats */}
          <div className="stats-grid">
            <div className="stat-card blue">
              <div className="stat-label">Folio</div>
              <div className="stat-value" style={{ fontSize: '1.1rem' }}>{data.folio || '—'}</div>
            </div>
            <div className="stat-card green">
              <div className="stat-label">Total</div>
              <div className="stat-value">{fmtMoney(data.total)}</div>
            </div>
            <div className="stat-card purple">
              <div className="stat-label">Conceptos</div>
              <div className="stat-value">{data.conceptos.length}</div>
            </div>
            {data.moneda && (
              <div className="stat-card yellow">
                <div className="stat-label">Moneda</div>
                <div className="stat-value" style={{ fontSize: '1.1rem' }}>{data.moneda}</div>
              </div>
            )}
          </div>

          {/* Emisor / Receptor */}
          <div className="grid-2">
            <div className="card">
              <div className="card-title"><span className="dot" style={{ background: '#f59e0b' }}></span>Emisor</div>
              <div className="chips">
                <div className="chip"><span className="chip-key">Nombre:</span><span className="chip-val">{data.emisor.nombre}</span></div>
                <div className="chip"><span className="chip-key">RFC:</span><span className="chip-val">{data.emisor.rfc}</span></div>
                {data.emisor.regimenFiscal && <div className="chip"><span className="chip-key">Régimen:</span><span className="chip-val">{data.emisor.regimenFiscal}</span></div>}
              </div>
            </div>
            <div className="card">
              <div className="card-title"><span className="dot" style={{ background: '#8b5cf6' }}></span>Receptor</div>
              <div className="chips">
                <div className="chip"><span className="chip-key">Nombre:</span><span className="chip-val">{data.receptor.nombre}</span></div>
                <div className="chip"><span className="chip-key">RFC:</span><span className="chip-val">{data.receptor.rfc}</span></div>
                {data.receptor.usoCFDI && <div className="chip"><span className="chip-key">Uso CFDI:</span><span className="chip-val">{data.receptor.usoCFDI}</span></div>}
              </div>
            </div>
          </div>

          {/* Fecha */}
          <div className="card">
            <div className="card-title"><span className="dot" style={{ background: '#10b981' }}></span>Fecha de emisión</div>
            <span style={{ color: '#6ee7b7', fontWeight: 600 }}>{data.fecha}</span>
          </div>

          {/* Conceptos */}
          <div className="card">
            <div className="card-title"><span className="dot"></span>Conceptos ({data.conceptos.length})</div>
            {data.conceptos.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-icon">📦</div>
                <p>No se encontraron conceptos en el XML.</p>
              </div>
            ) : (
              data.conceptos.map((c, i) => (
                <div key={i} className="concept-item">
                  <span className="concept-num">{i + 1}</span>
                  <div className="concept-detail">
                    <strong>{c.descripcion || '(sin descripción)'}</strong>
                    <span>Cant: {c.cantidad} | Valor unit: {fmtMoney(c.valorUnitario)} | Importe: {fmtMoney(c.importe)} {c.claveUnidad && `| Unidad: ${c.claveUnidad}`}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Actions */}
          <div className="card">
            <div className="card-title"><span className="dot" style={{ background: '#10b981' }}></span>Guardar en Firestore</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.83rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={checkDupe} onChange={e => setCheckDupe(e.target.checked)} style={{ accentColor: 'var(--accent-blue)' }} />
                Verificar duplicados por folio
              </label>
            </div>
            <div className="toolbar">
              <button className="btn btn-success" onClick={handleSave} disabled={saving}>
                {saving ? <><span className="loading-spinner"></span> Guardando…</> : '💾 Guardar en Firestore'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowRaw(!showRaw)}>
                {showRaw ? '🔼 Ocultar XML' : '📋 Ver XML raw'}
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleReset}>🗑️ Procesar otro</button>
            </div>
            {showRaw && <div className="code-block">{data.rawXML}</div>}
          </div>
        </>
      )}

      {/* Demo XML hint */}
      {!data && !fileName && (
        <div className="card" style={{ borderStyle: 'dashed' }}>
          <div className="card-title"><span className="dot" style={{ background: '#f59e0b' }}></span>💡 XML de ejemplo para probar</div>
          <div className="code-block">{`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  Version="4.0"
  Folio="1234"
  Fecha="2024-03-28T10:00:00"
  SubTotal="1000.00"
  Total="1160.00"
  Moneda="MXN">
  <cfdi:Emisor Nombre="Empresa Demo SA" Rfc="EDM010101001" RegimenFiscal="601"/>
  <cfdi:Receptor Nombre="Cliente Demo" Rfc="CDM020202002" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto Descripcion="Servicio de desarrollo" Cantidad="1"
      ClaveUnidad="E48" ValorUnitario="1000.00" Importe="1000.00"/>
  </cfdi:Conceptos>
</cfdi:Comprobante>`}</div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 12 }}>Copia este contenido, guárdalo como <code>.xml</code> y cárgalo aquí.</p>
        </div>
      )}
    </div>
  );
}
