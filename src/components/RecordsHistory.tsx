import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import {
  collection, addDoc, updateDoc, doc, query,
  orderBy, Timestamp, onSnapshot
} from 'firebase/firestore';

// ── Types ──
type Estado = 'Activo' | 'Inactivo' | 'Pendiente' | 'Cancelado' | 'Completado';

interface Registro {
  id: string;
  folio: string;
  descripcion: string;
  estado: Estado;
  fechaCreacion: string;
  eliminadoLogico?: boolean;
}

interface HistorialEvento {
  id: string;
  registroId: string;
  tipoEvento: 'CREACION' | 'ACTUALIZACION' | 'ELIMINACION';
  fecha: string;
  descripcionCambio: string;
}

const ESTADOS: Estado[] = ['Activo', 'Pendiente', 'Completado', 'Inactivo', 'Cancelado'];

function estadoBadge(e: string) {
  switch (e) {
    case 'Activo':     return <span className="badge badge-green">Activo</span>;
    case 'Pendiente':  return <span className="badge badge-yellow">Pendiente</span>;
    case 'Completado': return <span className="badge badge-blue">Completado</span>;
    case 'Inactivo':   return <span className="badge badge-gray">Inactivo</span>;
    case 'Cancelado':  return <span className="badge badge-red">Cancelado</span>;
    default:           return <span className="badge badge-gray">{e}</span>;
  }
}

function eventoDotClass(tipo: string) {
  switch (tipo) {
    case 'CREACION':     return 'create';
    case 'ACTUALIZACION': return 'update';
    case 'ELIMINACION':  return 'deleted';
    default:             return 'update';
  }
}

function eventoLabel(tipo: string) {
  switch (tipo) {
    case 'CREACION':     return 'CR';
    case 'ACTUALIZACION': return 'UP';
    case 'ELIMINACION':  return 'EL';
    default:             return 'EV';
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

// ── SVG Icons ──
const IconCheck = () => (
  <svg viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" style={{ width: 14, height: 14 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/>
  </svg>
);
const IconX = () => (
  <svg viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" fill="none" style={{ width: 14, height: 14 }}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
  </svg>
);
const IconEmpty = () => (
  <svg viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" fill="none">
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/>
  </svg>
);

// ── Component ──
export default function RecordsHistory() {
  const [registros,   setRegistros]   = useState<Registro[]>([]);
  const [historial,   setHistorial]   = useState<HistorialEvento[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [successMsg,  setSuccessMsg]  = useState('');

  // Form state
  const [folio,       setFolio]       = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [estado,      setEstado]      = useState<Estado>('Activo');

  // Edit state
  const [editId,      setEditId]      = useState<string | null>(null);
  const [editEstado,  setEditEstado]  = useState<Estado>('Activo');
  const [editMotivo,  setEditMotivo]  = useState('');

  // Detail panel
  const [detailId,    setDetailId]    = useState<string | null>(null);

  // Filters
  const [filterEstado,    setFilterEstado]    = useState('');
  const [filterFolio,     setFilterFolio]     = useState('');
  const [showEliminados,  setShowEliminados]  = useState(false);

  // Real-time listeners
  useEffect(() => {
    const unsubReg = onSnapshot(
      query(collection(db, 'registros'), orderBy('fechaCreacion', 'desc')),
      snap => {
        setRegistros(snap.docs.map(d => ({ id: d.id, ...d.data() } as Registro)));
        setLoading(false);
      },
      () => setLoading(false)
    );
    const unsubHist = onSnapshot(
      query(collection(db, 'historial'), orderBy('fecha', 'desc')),
      snap => setHistorial(snap.docs.map(d => ({ id: d.id, ...d.data() } as HistorialEvento)))
    );
    return () => { unsubReg(); unsubHist(); };
  }, []);

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 4000);
  }

  function validate(): string[] {
    const errs: string[] = [];
    if (!folio.trim())          errs.push('El campo Folio es obligatorio.');
    if (folio.trim().length < 2) errs.push('El Folio debe tener al menos 2 caracteres.');
    if (!descripcion.trim())    errs.push('El campo Descripcion es obligatorio.');
    if (!ESTADOS.includes(estado)) errs.push('El estado seleccionado no es valido.');
    return errs;
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errs = validate();
    if (errs.length > 0) { setError(errs.join(' ')); return; }

    const folioLower = folio.trim().toLowerCase();
    const existing = registros.find(r => r.folio.toLowerCase() === folioLower && !r.eliminadoLogico);
    if (existing) {
      setError(`Ya existe un registro activo con el folio "${folio.trim()}".`);
      return;
    }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const ref = await addDoc(collection(db, 'registros'), {
        folio: folio.trim(), descripcion: descripcion.trim(),
        estado, fechaCreacion: now, eliminadoLogico: false
      });
      await addDoc(collection(db, 'historial'), {
        registroId: ref.id, tipoEvento: 'CREACION', fecha: now,
        descripcionCambio: `Registro creado. Estado inicial: "${estado}". Descripcion: "${descripcion.trim()}"`
      });
      setFolio(''); setDescripcion(''); setEstado('Activo');
      showSuccess(`Registro "${folio.trim()}" creado correctamente.`);
    } catch (err) {
      setError('Error al crear el registro: ' + String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editId || !editMotivo.trim()) {
      setError('El motivo del cambio es obligatorio.');
      return;
    }
    const reg = registros.find(r => r.id === editId);
    if (!reg) return;
    if (reg.estado === editEstado) {
      setError('El nuevo estado debe ser diferente al estado actual.');
      return;
    }

    setSaving(true); setError('');
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'registros', editId), { estado: editEstado });
      await addDoc(collection(db, 'historial'), {
        registroId: editId, tipoEvento: 'ACTUALIZACION', fecha: now,
        descripcionCambio: `Estado modificado: "${reg.estado}" -> "${editEstado}". Motivo: ${editMotivo.trim()}`
      });
      setEditId(null); setEditMotivo('');
      showSuccess(`Estado actualizado a "${editEstado}" correctamente.`);
    } catch (err) {
      setError('Error al actualizar: ' + String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const reg = registros.find(r => r.id === id);
    if (!reg) return;
    if (!window.confirm(`Confirmar eliminacion logica del registro "${reg.folio}".`)) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'registros', id), { eliminadoLogico: true, estado: 'Cancelado' });
      await addDoc(collection(db, 'historial'), {
        registroId: id, tipoEvento: 'ELIMINACION', fecha: now,
        descripcionCambio: `Eliminacion logica aplicada. Estado previo: "${reg.estado}".`
      });
      showSuccess('Registro eliminado de forma logica.');
    } catch (err) {
      setError('Error: ' + String(err));
    } finally {
      setSaving(false);
    }
  };

  const filteredReg = registros.filter(r => {
    if (!showEliminados && r.eliminadoLogico) return false;
    if (filterEstado && r.estado !== filterEstado) return false;
    if (filterFolio && !r.folio.toLowerCase().includes(filterFolio.toLowerCase())) return false;
    return true;
  });

  const selectedDetail  = registros.find(r => r.id === detailId);
  const detailHistory   = historial.filter(h => h.registroId === detailId);
  const editingReg      = registros.find(r => r.id === editId);

  return (
    <div className="fade-in">
      <div className="section-header">
        <h2>Registros con Historial de Cambios</h2>
        <p>
          Modulo para crear registros, actualizar su estado y consultar el historial completo de
          eventos. Cada modificacion genera un evento de auditoria automatico persistido en
          Firestore. Soporta eliminacion logica y actualizaciones en tiempo real.
        </p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card blue">
          <div className="stat-label">Total de registros</div>
          <div className="stat-value">{registros.filter(r => !r.eliminadoLogico).length}</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Activos</div>
          <div className="stat-value">{registros.filter(r => r.estado === 'Activo' && !r.eliminadoLogico).length}</div>
        </div>
        <div className="stat-card gray">
          <div className="stat-label">Pendientes</div>
          <div className="stat-value">{registros.filter(r => r.estado === 'Pendiente' && !r.eliminadoLogico).length}</div>
        </div>
        <div className="stat-card gray">
          <div className="stat-label">Eventos registrados</div>
          <div className="stat-value">{historial.length}</div>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="alert alert-error">
          <span className="alert-icon"><IconX /></span>
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
            <IconX />
          </button>
        </div>
      )}
      {successMsg && (
        <div className="alert alert-success">
          <span className="alert-icon"><IconCheck /></span>
          <span>{successMsg}</span>
        </div>
      )}

      <div className="grid-2">
        {/* Create form */}
        <div className="card">
          <div className="card-title"><span className="card-title-bar" />Crear nuevo registro</div>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label className="form-label">Folio *</label>
              <input
                className="form-input"
                type="text"
                placeholder="Ej. REG-001"
                value={folio}
                onChange={e => setFolio(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Descripcion *</label>
              <textarea
                className="form-textarea"
                placeholder="Descripcion del registro..."
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Estado inicial</label>
              <select
                className="form-select"
                value={estado}
                onChange={e => setEstado(e.target.value as Estado)}
              >
                {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving} style={{ width: '100%' }}>
              {saving ? <><span className="spinner" /> Guardando…</> : 'Crear registro'}
            </button>
          </form>
        </div>

        {/* Edit panel */}
        {editId && editingReg && (
          <div className="card" style={{ border: '1px solid #93c5fd' }}>
            <div className="card-title">
              <span className="card-title-bar" />
              Actualizar estado — {editingReg.folio}
            </div>
            <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Estado actual:</span>
              {estadoBadge(editingReg.estado)}
            </div>
            <div className="form-group">
              <label className="form-label">Nuevo estado *</label>
              <select
                className="form-select"
                value={editEstado}
                onChange={e => setEditEstado(e.target.value as Estado)}
              >
                {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Motivo del cambio *</label>
              <textarea
                className="form-textarea"
                placeholder="Describa el motivo de la modificacion..."
                value={editMotivo}
                onChange={e => setEditMotivo(e.target.value)}
                required
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleUpdate} disabled={saving}>
                {saving ? <><span className="spinner" /> Guardando…</> : 'Guardar cambio'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setEditId(null); setError(''); }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Detail panel */}
        {detailId && selectedDetail && (
          <div className="card" style={{ border: '1px solid var(--border-strong)' }}>
            <div className="card-title" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="card-title-bar" />
                Historial de eventos — {selectedDetail.folio}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setDetailId(null)}>
                Cerrar
              </button>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div className="kv-list">
                <div className="kv-item"><span className="kv-key">Folio</span><span className="kv-val">{selectedDetail.folio}</span></div>
                <div className="kv-item"><span className="kv-key">Estado</span><span className="kv-val">{selectedDetail.estado}</span></div>
                <div className="kv-item"><span className="kv-key">Creado</span><span className="kv-val">{fmtDate(selectedDetail.fechaCreacion)}</span></div>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 10 }}>
                {selectedDetail.descripcion}
              </p>
            </div>
            <div className="divider" />
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--gray-500)',
                          textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 12 }}>
              Eventos ({detailHistory.length})
            </div>
            {detailHistory.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                Sin eventos registrados.
              </p>
            ) : (
              <div className="timeline">
                {detailHistory.map(h => (
                  <div key={h.id} className="timeline-item">
                    <div className={`timeline-dot ${eventoDotClass(h.tipoEvento)}`}>
                      {eventoLabel(h.tipoEvento)}
                    </div>
                    <div className="timeline-content">
                      <h4>{h.tipoEvento}</h4>
                      <p>{h.descripcionCambio}</p>
                      <div className="timeline-date">{fmtDate(h.fecha)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Records list */}
      <div className="card">
        <div className="card-title"><span className="card-title-bar" />Lista de registros</div>
        <div className="toolbar" style={{ marginBottom: 14 }}>
          <input
            type="text"
            className="form-input"
            placeholder="Buscar por folio..."
            value={filterFolio}
            onChange={e => setFilterFolio(e.target.value)}
            style={{ maxWidth: 220 }}
          />
          <select
            className="form-select"
            value={filterEstado}
            onChange={e => setFilterEstado(e.target.value)}
            style={{ maxWidth: 180 }}
          >
            <option value="">Todos los estados</option>
            {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem',
                          cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={showEliminados}
              onChange={e => setShowEliminados(e.target.checked)}
              style={{ accentColor: 'var(--blue-600)' }}
            />
            Mostrar eliminados
          </label>
        </div>

        {loading ? (
          <div className="empty-state">
            <span className="spinner" />
          </div>
        ) : filteredReg.length === 0 ? (
          <div className="empty-state">
            <IconEmpty />
            <h3>Sin registros</h3>
            <p>Cree el primer registro usando el formulario de arriba.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Descripcion</th>
                  <th>Estado</th>
                  <th>Fecha de creacion</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredReg.map(r => (
                  <tr key={r.id} style={r.eliminadoLogico ? { opacity: 0.5 } : {}}>
                    <td><strong>{r.folio}</strong></td>
                    <td style={{ maxWidth: 260 }}>
                      <span style={{ display: 'block', overflow: 'hidden',
                                     textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.descripcion}
                      </span>
                    </td>
                    <td>
                      {estadoBadge(r.estado)}
                      {r.eliminadoLogico && (
                        <span className="badge badge-red" style={{ marginLeft: 6 }}>Eliminado</span>
                      )}
                    </td>
                    <td>{fmtDate(r.fechaCreacion)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setDetailId(r.id === detailId ? null : r.id)}
                        >
                          Ver historial
                        </button>
                        {!r.eliminadoLogico && (
                          <>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => {
                                setEditId(r.id);
                                setEditEstado(r.estado);
                                setEditMotivo('');
                                setError('');
                              }}
                            >
                              Editar
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleDelete(r.id)}
                            >
                              Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Global history */}
      <div className="card">
        <div className="card-title"><span className="card-title-bar" />Historial global de eventos</div>
        {historial.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <IconEmpty />
            <p>Sin eventos registrados.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tipo de evento</th>
                  <th>Folio</th>
                  <th>Descripcion del cambio</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {historial.slice(0, 50).map(h => {
                  const reg = registros.find(r => r.id === h.registroId);
                  return (
                    <tr key={h.id}>
                      <td>
                        <span className={`badge ${
                          h.tipoEvento === 'CREACION'      ? 'badge-green' :
                          h.tipoEvento === 'ACTUALIZACION' ? 'badge-blue'  : 'badge-red'
                        }`}>
                          {h.tipoEvento}
                        </span>
                      </td>
                      <td><strong>{reg?.folio || h.registroId.slice(0, 8) + '…'}</strong></td>
                      <td style={{ maxWidth: 320, overflow: 'hidden',
                                   textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {h.descripcionCambio}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(h.fecha)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
