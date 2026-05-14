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
    errors.push({ type: 'error', message: 'El archivo XML esta vacio.' });
    return { data: null, errors };
  }

  let doc: Document;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(xmlText, 'application/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      errors.push({ type: 'error', message: 'XML invalido: estructura incorrecta o malformada.' });
      return { data: null, errors };
    }
  } catch {
    errors.push({ type: 'error', message: 'Error al procesar el archivo XML.' });
    return { data: null, errors };
  }

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
    const all = Array.from(doc.getElementsByTagName('*'));
    return all.find(e => e.localName === tag) || null;
  };

  const comprobante = getEl('Comprobante');
  if (!comprobante) {
    errors.push({ type: 'error', message: 'Nodo raiz Comprobante no encontrado.' });
    return { data: null, errors };
  }

  const folio      = comprobante.getAttribute('Folio')    || comprobante.getAttribute('folio')    || '';
  const fecha      = comprobante.getAttribute('Fecha')    || comprobante.getAttribute('fecha')    || '';
  const totalStr   = comprobante.getAttribute('Total')    || comprobante.getAttribute('total')    || '';
  const subTotalStr = comprobante.getAttribute('SubTotal') || '';
  const moneda     = comprobante.getAttribute('Moneda')   || '';

  if (!folio)    errors.push({ type: 'warning', message: 'Atributo Folio no encontrado.' });
  if (!fecha)    errors.push({ type: 'error',   message: 'Atributo Fecha no encontrado.' });
  if (!totalStr) errors.push({ type: 'error',   message: 'Atributo Total no encontrado.' });

  const total = parseFloat(totalStr);
  if (totalStr && isNaN(total)) {
    errors.push({ type: 'error', message: 'El valor de Total no es un numero valido.' });
  }

  const emisorEl = getEl('Emisor');
  if (!emisorEl) errors.push({ type: 'error', message: 'Nodo Emisor no encontrado.' });
  const emisor = {
    nombre:        emisorEl?.getAttribute('Nombre')        || emisorEl?.getAttribute('nombre')       || '(sin nombre)',
    rfc:           emisorEl?.getAttribute('Rfc')           || emisorEl?.getAttribute('rfc')          || '(sin RFC)',
    regimenFiscal: emisorEl?.getAttribute('RegimenFiscal') || ''
  };

  const receptorEl = getEl('Receptor');
  if (!receptorEl) errors.push({ type: 'error', message: 'Nodo Receptor no encontrado.' });
  const receptor = {
    nombre:  receptorEl?.getAttribute('Nombre')  || receptorEl?.getAttribute('nombre') || '(sin nombre)',
    rfc:     receptorEl?.getAttribute('Rfc')     || receptorEl?.getAttribute('rfc')    || '(sin RFC)',
    usoCFDI: receptorEl?.getAttribute('UsoCFDI') || ''
  };

  const conceptosEl = getEl('Conceptos');
  if (!conceptosEl) errors.push({ type: 'warning', message: 'Nodo Conceptos no encontrado.' });

  const conceptoEls = conceptosEl
    ? Array.from(conceptosEl.getElementsByTagName('*')).filter(e => e.localName === 'Concepto')
    : [];

  const conceptos: Concepto[] = conceptoEls.map(el => ({
    descripcion:   el.getAttribute('Descripcion')   || el.getAttribute('descripcion')   || '',
    cantidad:      parseFloat(el.getAttribute('Cantidad')      || '0'),
    valorUnitario: parseFloat(el.getAttribute('ValorUnitario') || '0'),
    importe:       parseFloat(el.getAttribute('Importe')       || '0'),
    claveUnidad:   el.getAttribute('ClaveUnidad') || ''
  }));

  if (errors.some(e => e.type === 'error')) {
    return { data: null, errors };
  }

  return {
    data: { folio, fecha, emisor, receptor, total: isNaN(total) ? 0 : total,
            subTotal: parseFloat(subTotalStr) || undefined, moneda, conceptos, rawXML: xmlText },
    errors
  };
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n);
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

const IconInfo = () => (
  <svg viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none">
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/>
  </svg>
);

// ── Component ──
export default function XMLProcessor() {
  const [dragging, setDragging]   = useState(false);
  const [fileName, setFileName]   = useState('');
  const [fileSize, setFileSize]   = useState(0);
  const [errors, setErrors]       = useState<ValidationError[]>([]);
  const [data, setData]           = useState<CFDIData | null>(null);
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState('');
  const [showRaw, setShowRaw]     = useState(false);
  const [checkDupe, setCheckDupe] = useState(false);

  const processFile = useCallback(async (file: File) => {
    setErrors([]); setData(null); setSaveMsg('');
    setFileName(file.name); setFileSize(file.size);

    if (!file.name.toLowerCase().endsWith('.xml')) {
      setErrors([{ type: 'error', message: 'El archivo debe tener extension .xml' }]);
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
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleSave = async () => {
    if (!data) return;
    setSaving(true); setSaveMsg('');
    try {
      if (checkDupe) {
        const q = query(collection(db, 'xml_documentos'), where('folio', '==', data.folio));
        const snap = await getDocs(q);
        if (!snap.empty) {
          setSaveMsg('warn:Ya existe un documento con el folio ' + data.folio);
          setSaving(false); return;
        }
      }
      await addDoc(collection(db, 'xml_documentos'), {
        folio: data.folio, fecha: data.fecha, emisor: data.emisor,
        receptor: data.receptor, total: data.total,
        subTotal: data.subTotal ?? null, moneda: data.moneda ?? '',
        conceptos: data.conceptos, archivoNombre: fileName,
        guardadoEn: Timestamp.now()
      });
      setSaveMsg('ok:Documento guardado correctamente en la base de datos.');
    } catch (err) {
      setSaveMsg('err:Error al guardar: ' + String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setData(null); setErrors([]); setFileName('');
    setFileSize(0); setSaveMsg(''); setShowRaw(false);
  };

  const hasErrors   = errors.some(e => e.type === 'error');
  const hasWarnings = errors.some(e => e.type === 'warning');

  const [saveMsgType, saveMsgText] = saveMsg.includes(':')
    ? [saveMsg.split(':')[0], saveMsg.slice(saveMsg.indexOf(':') + 1)]
    : ['', saveMsg];

  return (
    <div className="fade-in">
      <div className="section-header">
        <h2>Procesamiento de Archivo XML (CFDI)</h2>
        <p>
          Carga un archivo XML de tipo CFDI (SAT Mexico). El sistema extrae Folio, Fecha, Emisor,
          Receptor, Total y lista de conceptos. Compatible con CFDI 3.3 y 4.0.
          Los datos pueden persistirse en Firestore con verificacion de duplicados por folio.
        </p>
      </div>

      {/* Upload */}
      {!data && (
        <div className="card">
          <div className="card-title">
            <span className="card-title-bar" />
            Cargar archivo XML
          </div>
          <div
            className={`upload-zone ${dragging ? 'dragging' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input type="file" accept=".xml" onChange={handleFileChange} />
            <div className="upload-icon"><IconUpload /></div>
            <h3>Seleccionar archivo XML</h3>
            <p>Arrastre el archivo aqui o haga clic para buscar</p>
            <div className="file-types">
              <span className="file-type-pill">XML</span>
              <span className="file-type-pill">CFDI 3.3</span>
              <span className="file-type-pill">CFDI 4.0</span>
            </div>
          </div>
        </div>
      )}

      {/* File bar */}
      {fileName && (
        <div className="file-bar">
          <span className="file-bar-name">{fileName}</span>
          <span className="file-bar-meta">{(fileSize / 1024).toFixed(1)} KB</span>
          <button className="btn btn-secondary btn-sm" onClick={handleReset}>Limpiar</button>
        </div>
      )}

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className={`alert ${hasErrors ? 'alert-error' : 'alert-warning'}`}>
          <span className="alert-icon">{hasErrors ? <IconX /> : <IconWarn />}</span>
          <div>
            <strong>{hasErrors ? 'Errores de validacion:' : 'Advertencias:'}</strong>
            <ul>{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
          </div>
        </div>
      )}

      {/* Save message */}
      {saveMsg && (
        <div className={`alert ${saveMsgType === 'ok' ? 'alert-success' : saveMsgType === 'warn' ? 'alert-warning' : 'alert-error'}`}>
          <span className="alert-icon">
            {saveMsgType === 'ok' ? <IconCheck /> : saveMsgType === 'warn' ? <IconWarn /> : <IconX />}
          </span>
          <span>{saveMsgText}</span>
        </div>
      )}

      {/* Result */}
      {data && (
        <>
          {hasWarnings && !hasErrors && (
            <div className="alert alert-warning">
              <span className="alert-icon"><IconWarn /></span>
              <div>
                <strong>Procesado con advertencias:</strong>
                <ul>{errors.filter(e => e.type === 'warning').map((e, i) => <li key={i}>{e.message}</li>)}</ul>
              </div>
            </div>
          )}

          <div className="alert alert-success">
            <span className="alert-icon"><IconCheck /></span>
            <span>
              Archivo procesado correctamente. Se encontraron{' '}
              <strong>{data.conceptos.length}</strong> concepto(s).
            </span>
          </div>

          {/* Stats */}
          <div className="stats-grid">
            <div className="stat-card blue">
              <div className="stat-label">Folio</div>
              <div className="stat-value" style={{ fontSize: '1rem', lineHeight: 1.4 }}>{data.folio || '—'}</div>
            </div>
            <div className="stat-card green">
              <div className="stat-label">Total</div>
              <div className="stat-value" style={{ fontSize: '1.1rem' }}>{fmtMoney(data.total)}</div>
            </div>
            <div className="stat-card gray">
              <div className="stat-label">Conceptos</div>
              <div className="stat-value">{data.conceptos.length}</div>
            </div>
            {data.moneda && (
              <div className="stat-card gray">
                <div className="stat-label">Moneda</div>
                <div className="stat-value" style={{ fontSize: '1rem', lineHeight: 1.4 }}>{data.moneda}</div>
              </div>
            )}
          </div>

          {/* Emisor / Receptor */}
          <div className="grid-2">
            <div className="card">
              <div className="card-title"><span className="card-title-bar" />Emisor</div>
              <div className="kv-list">
                <div className="kv-item"><span className="kv-key">Nombre</span><span className="kv-val">{data.emisor.nombre}</span></div>
                <div className="kv-item"><span className="kv-key">RFC</span><span className="kv-val">{data.emisor.rfc}</span></div>
                {data.emisor.regimenFiscal && (
                  <div className="kv-item"><span className="kv-key">Regimen</span><span className="kv-val">{data.emisor.regimenFiscal}</span></div>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card-title"><span className="card-title-bar" />Receptor</div>
              <div className="kv-list">
                <div className="kv-item"><span className="kv-key">Nombre</span><span className="kv-val">{data.receptor.nombre}</span></div>
                <div className="kv-item"><span className="kv-key">RFC</span><span className="kv-val">{data.receptor.rfc}</span></div>
                {data.receptor.usoCFDI && (
                  <div className="kv-item"><span className="kv-key">Uso CFDI</span><span className="kv-val">{data.receptor.usoCFDI}</span></div>
                )}
              </div>
            </div>
          </div>

          {/* Fecha */}
          <div className="card">
            <div className="card-title"><span className="card-title-bar" />Fecha de emision</div>
            <span style={{ fontWeight: 600, color: 'var(--gray-900)' }}>{data.fecha}</span>
          </div>

          {/* Conceptos */}
          <div className="card">
            <div className="card-title">
              <span className="card-title-bar" />
              Lista de conceptos ({data.conceptos.length})
            </div>
            {data.conceptos.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                No se encontraron conceptos en el documento.
              </p>
            ) : (
              data.conceptos.map((c, i) => (
                <div key={i} className="data-row">
                  <span className="data-row-num">{i + 1}</span>
                  <div className="data-row-content">
                    <strong>{c.descripcion || '(sin descripcion)'}</strong>
                    <span>
                      Cantidad: {c.cantidad} &nbsp;|&nbsp;
                      Valor unitario: {fmtMoney(c.valorUnitario)} &nbsp;|&nbsp;
                      Importe: {fmtMoney(c.importe)}
                      {c.claveUnidad && <> &nbsp;|&nbsp; Unidad: {c.claveUnidad}</>}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Actions */}
          <div className="card">
            <div className="card-title"><span className="card-title-bar" />Guardar registro</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem',
                            cursor: 'pointer', color: 'var(--text-secondary)', marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={checkDupe}
                onChange={e => setCheckDupe(e.target.checked)}
                style={{ accentColor: 'var(--blue-600)' }}
              />
              Verificar duplicados por folio antes de guardar
            </label>
            <div className="toolbar">
              <button className="btn btn-success" onClick={handleSave} disabled={saving}>
                {saving ? <><span className="spinner" /> Guardando…</> : 'Guardar en base de datos'}
              </button>
              <button className="btn btn-secondary" onClick={() => setShowRaw(!showRaw)}>
                {showRaw ? 'Ocultar XML' : 'Ver contenido XML'}
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleReset}>Procesar otro archivo</button>
            </div>
            {showRaw && <div className="code-block" style={{ marginTop: 14 }}>{data.rawXML}</div>}
          </div>
        </>
      )}

      {/* Sample XML */}
      {!data && !fileName && (
        <div className="card">
          <div className="card-title"><span className="card-title-bar" />Estructura de referencia — CFDI 4.0</div>
          <div className="alert alert-info" style={{ marginBottom: 12 }}>
            <span className="alert-icon"><IconInfo /></span>
            <span>
              Puede copiar el contenido de abajo, guardarlo con extension .xml y cargarlo
              para verificar el funcionamiento del parser.
            </span>
          </div>
          <div className="code-block">{`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  Version="4.0"
  Folio="1234"
  Fecha="2024-03-28T10:00:00"
  SubTotal="1000.00"
  Total="1160.00"
  Moneda="MXN">
  <cfdi:Emisor Nombre="Empresa Ejemplo SA de CV" Rfc="EEJ010101AAA" RegimenFiscal="601"/>
  <cfdi:Receptor Nombre="Cliente Corporativo SRL" Rfc="CCS020202BBB" UsoCFDI="G03"/>
  <cfdi:Conceptos>
    <cfdi:Concepto Descripcion="Servicios de desarrollo de software"
      Cantidad="1" ClaveUnidad="E48"
      ValorUnitario="1000.00" Importe="1000.00"/>
  </cfdi:Conceptos>
</cfdi:Comprobante>`}</div>
        </div>
      )}
    </div>
  );
}
