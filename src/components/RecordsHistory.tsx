import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import {
  collection, addDoc, getDocs, updateDoc, doc, query,
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
    case 'Activo': return <span className="badge badge-green">● Activo</span>;
    case 'Pendiente': return <span className="badge badge-yellow">◐ Pendiente</span>;
    case 'Completado': return <span className="badge badge-blue">✓ Completado</span>;
    case 'Inactivo': return <span className="badge badge-gray">○ Inactivo</span>;
    case 'Cancelado': return <span className="badge badge-red">✕ Cancelado</span>;
    default: return <span className="badge badge-gray">{e}</span>;
  }
}

function eventoBadge(tipo: string) {
  switch (tipo) {
    case 'CREACION': return '🟢';
    case 'ACTUALIZACION': return '🔵';
    case 'ELIMINACION': return '🔴';
    default: return '⚪';
  }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

// ── Component ──
export default function RecordsHistory() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [historial, setHistorial] = useState<HistorialEvento[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Form
  const [folio, setFolio] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [estado, setEstado] = useState<Estado>('Activo');

  // Update modal
  const [editId, setEditId] = useState<string | null>(null);
  const [editEstado, setEditEstado] = useState<Estado>('Activo');
  const [editMotivo, setEditMotivo] = useState('');

  // Detail
  const [detailId, setDetailId] = useState<string | null>(null);

  // Filters
  const [filterEstado, setFilterEstado] = useState('');
  const [filterFolio, setFilterFolio] = useState('');
  const [showEliminados, setShowEliminados] = useState(false);

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

  // ── Validate ──
  function validate(): string[] {
    const errs: string[] = [];
    if (!folio.trim()) errs.push('Folio es obligatorio.');
    if (folio.trim().length < 2) errs.push('Folio debe tener al menos 2 caracteres.');
    if (!descripcion.trim()) errs.push('Descripción es obligatoria.');
    if (!ESTADOS.includes(estado)) errs.push('Estado inválido.');
    return errs;
  }

  // ── Create ──
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const errs = validate();
    if (errs.length > 0) { setError(errs.join(' ')); return; }

    // Check folio duplicado
    const folioLower = folio.trim().toLowerCase();
    const existing = registros.find(r => r.folio.toLowerCase() === folioLower && !r.eliminadoLogico);
    if (existing) { setError(`Ya existe un registro activo con folio "${folio.trim()}".`); return; }

    setSaving(true);
    try {
      const now = new Date().toISOString();
      const ref = await addDoc(collection(db, 'registros'), {
        folio: folio.trim(),
        descripcion: descripcion.trim(),
        estado,
        fechaCreacion: now,
        eliminadoLogico: false
      });

      await addDoc(collection(db, 'historial'), {
        registroId: ref.id,
        tipoEvento: 'CREACION',
        fecha: now,
        descripcionCambio: `Registro creado con estado "${estado}". Descripción: "${descripcion.trim()}"`
      });

      setFolio('');
      setDescripcion('');
      setEstado('Activo');
      showSuccess(`✅ Registro "${folio.trim()}" creado exitosamente.`);
    } catch (err) {
      setError('Error al crear: ' + String(err));
    } finally {
      setSaving(false);
    }
  };

  // ── Update Estado ──
  const handleUpdate = async () => {
    if (!editId || !editMotivo.trim()) { setError('El motivo del cambio es obligatorio.'); return; }
    const reg = registros.find(r => r.id === editId);
    if (!reg) return;
    if (reg.estado === editEstado) { setError('El estado nuevo debe ser diferente al actual.'); return; }

    setSaving(true);
    setError('');
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'registros', editId), { estado: editEstado });
      await addDoc(collection(db, 'historial'), {
        registroId: editId,
        tipoEvento: 'ACTUALIZACION',
        fecha: now,
        descripcionCambio: `Estado cambiado de "${reg.estado}" → "${editEstado}". Motivo: ${editMotivo.trim()}`
      });
      setEditId(null);
      setEditMotivo('');
      showSuccess(`✅ Registro actualizado a "${editEstado}".`);
    } catch (err) {
      setError('Error al actualizar: ' + String(err));
    } finally {
      setSaving(false);
    }
  };

  // ── Soft Delete ──
  const handleDelete = async (id: string) => {
    const reg = registros.find(r => r.id === id);
    if (!reg) return;
    if (!window.confirm(`¿Eliminar lógicamente el registro "${reg.folio}"?`)) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'registros', id), { eliminadoLogico: true, estado: 'Cancelado' });
      await addDoc(collection(db, 'historial'), {
        registroId: id,
        tipoEvento: 'ELIMINACION',
        fecha: now,
        descripcionCambio: `Registro eliminado lógicamente (soft delete). Estado anterior: "${reg.estado}".`
      });
      showSuccess('✅ Registro eliminado lógicamente.');
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

  const selectedDetail = registros.find(r => r.id === detailId);
  const detailHistory = historial.filter(h => h.registroId === detailId);

  return (
    <div className="fade-in">
      <div className="section-header">
        <h2>🗃️ Registros con Historial de Cambios</h2>
        <p>Crea registros, actualiza su estado y consulta el historial completo de eventos. Todo se persiste en Firestore con eliminación lógica.</p>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card blue">
          <div className="stat-label">Total Registros</div>
          <div className="stat-value">{registros.filter(r => !r.eliminadoLogico).length}</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">Activos</div>
          <div className="stat-value">{registros.filter(r => r.estado === 'Activo' && !r.eliminadoLogico).length}</div>
        </div>
        <div className="stat-card yellow">
          <div className="stat-label">Pendientes</div>
          <div className="stat-value">{registros.filter(r => r.estado === 'Pendiente' && !r.eliminadoLogico).length}</div>
        </div>
        <div className="stat-card purple">
          <div className="stat-label">Eventos Historial</div>
          <div className="stat-value">{historial.length}</div>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="alert alert-error">
          <span className="alert-icon">❌</span>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
        </div>
      )}
      {successMsg && (
        <div className="alert alert-success">
          <span className="alert-icon">✅</span>
          <span>{successMsg}</span>
        </div>
      )}

      <div className="grid-2">
        {/* Create Form */}
        <div className="card">
          <div className="card-title"><span className="dot" style={{ background: '#10b981' }}></span>Crear Nuevo Registro</div>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label className="form-label">Folio *</label>
              <input
                className="form-input"
                type="text"
                placeholder="Ej: REG-001"
                value={folio}
                onChange={e => setFolio(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Descripción *</label>
              <textarea
                className="form-textarea"
                placeholder="Descripción del registro..."
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Estado inicial</label>
              <select className="form-select" value={estado} onChange={e => setEstado(e.target.value as Estado)}>
                {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <button type="submit" className="btn btn-success" disabled={saving} style={{ width: '100%' }}>
              {saving ? <><span className="loading-spinner"></span> Guardando…</> : '➕ Crear Registro'}
            </button>
          </form>
        </div>

        {/* Edit Modal (inline) */}
        {editId && (() => {
          const reg = registros.find(r => r.id === editId);
          return (
            <div className="card" style={{ border: '1px solid rgba(59,130,246,0.4)', background: 'rgba(59,130,246,0.05)' }}>
              <div className="card-title"><span className="dot"></span>Actualizar Estado — {reg?.folio}</div>
              <div style={{ marginBottom: 12 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Estado actual: </span>
                {estadoBadge(reg?.estado || '')}
              </div>
              <div className="form-group">
                <label className="form-label">Nuevo estado *</label>
                <select className="form-select" value={editEstado} onChange={e => setEditEstado(e.target.value as Estado)}>
                  {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Motivo del cambio *</label>
                <textarea
                  className="form-textarea"
                  placeholder="Describe el motivo del cambio de estado..."
                  value={editMotivo}
                  onChange={e => setEditMotivo(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={handleUpdate} disabled={saving}>
                  {saving ? <span className="loading-spinner"></span> : '💾 Actualizar'}
                </button>
                <button className="btn btn-secondary" onClick={() => { setEditId(null); setError(''); }}>Cancelar</button>
              </div>
            </div>
          );
        })()}

        {/* Detail Panel */}
        {detailId && selectedDetail && (
          <div className="card" style={{ border: '1px solid rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.05)' }}>
            <div className="card-title">
              <span className="dot" style={{ background: '#8b5cf6' }}></span>
              Historial — {selectedDetail.folio}
              <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setDetailId(null)}>✕ Cerrar</button>
            </div>
            <div className="chips" style={{ marginBottom: 16 }}>
              <div className="chip"><span className="chip-key">Folio:</span><span className="chip-val">{selectedDetail.folio}</span></div>
              <div className="chip"><span className="chip-key">Estado:</span><span className="chip-val">{selectedDetail.estado}</span></div>
              <div className="chip"><span className="chip-key">Creado:</span><span className="chip-val">{fmtDate(selectedDetail.fechaCreacion)}</span></div>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>📝 {selectedDetail.descripcion}</p>
            <div className="divider"></div>
            <div style={{ fontWeight: 600, fontSize: '0.83rem', marginBottom: 12 }}>Eventos ({detailHistory.length})</div>
            {detailHistory.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.83rem' }}>Sin eventos registrados.</p>
            ) : (
              <div className="timeline">
                {detailHistory.map(h => (
                  <div key={h.id} className="timeline-item">
                    <div className={`timeline-dot ${h.tipoEvento === 'CREACION' ? 'create' : 'update'}`}>
                      {eventoBadge(h.tipoEvento)}
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
        <div className="card-title"><span className="dot"></span>Lista de Registros</div>
        <div className="toolbar" style={{ marginBottom: 12 }}>
          <input
            type="text"
            className="form-input"
            placeholder="Buscar por folio..."
            value={filterFolio}
            onChange={e => setFilterFolio(e.target.value)}
            style={{ maxWidth: 220 }}
          />
          <select className="form-select" value={filterEstado} onChange={e => setFilterEstado(e.target.value)} style={{ maxWidth: 180 }}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.83rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={showEliminados} onChange={e => setShowEliminados(e.target.checked)} style={{ accentColor: 'var(--accent-blue)' }} />
            Mostrar eliminados
          </label>
        </div>

        {loading ? (
          <div className="empty-state"><span className="loading-spinner"></span></div>
        ) : filteredReg.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🗃️</div>
            <h3>No hay registros</h3>
            <p>Crea tu primer registro usando el formulario de arriba.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Folio</th>
                  <th>Descripción</th>
                  <th>Estado</th>
                  <th>Fecha Creación</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredReg.map(r => (
                  <tr key={r.id} style={r.eliminadoLogico ? { opacity: 0.5 } : {}}>
                    <td><strong>{r.folio}</strong></td>
                    <td style={{ maxWidth: 280 }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.descripcion}
                      </span>
                    </td>
                    <td>
                      {estadoBadge(r.estado)}
                      {r.eliminadoLogico && <span className="badge badge-red" style={{ marginLeft: 6 }}>Eliminado</span>}
                    </td>
                    <td>{fmtDate(r.fechaCreacion)}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => { setDetailId(r.id === detailId ? null : r.id); }}
                          title="Ver historial"
                        >
                          📋 Historial
                        </button>
                        {!r.eliminadoLogico && (
                          <>
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => { setEditId(r.id); setEditEstado(r.estado); setEditMotivo(''); setError(''); }}
                              title="Actualizar estado"
                            >
                              ✏️ Editar
                            </button>
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => handleDelete(r.id)}
                              title="Eliminar lógicamente"
                            >
                              🗑️
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

      {/* Global Historial */}
      <div className="card">
        <div className="card-title"><span className="dot" style={{ background: '#8b5cf6' }}></span>Historial Global de Eventos</div>
        {historial.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="empty-icon">📋</div>
            <p>No hay eventos registrados todavía.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Registro ID</th>
                  <th>Descripción</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {historial.slice(0, 30).map(h => {
                  const reg = registros.find(r => r.id === h.registroId);
                  return (
                    <tr key={h.id}>
                      <td>
                        <span className={`badge ${h.tipoEvento === 'CREACION' ? 'badge-green' : h.tipoEvento === 'ACTUALIZACION' ? 'badge-blue' : 'badge-red'}`}>
                          {eventoBadge(h.tipoEvento)} {h.tipoEvento}
                        </span>
                      </td>
                      <td><strong>{reg?.folio || h.registroId.slice(0, 8) + '…'}</strong></td>
                      <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {h.descripcionCambio}
                      </td>
                      <td>{fmtDate(h.fecha)}</td>
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
