import { useState } from 'react';
import XMLProcessor from './components/XMLProcessor';
import CSVAnalyzer from './components/CSVAnalyzer';
import RecordsHistory from './components/RecordsHistory';

type Tab = 'xml' | 'csv' | 'records';

const TABS = [
  { id: 'xml' as Tab, icon: '🗂️', label: 'Procesador XML', num: '01' },
  { id: 'csv' as Tab, icon: '📊', label: 'Análisis CSV / Excel', num: '02' },
  { id: 'records' as Tab, icon: '🗃️', label: 'Registros & Historial', num: '03' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('xml');

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="app-header">
        <div className="header-inner">
          <div className="header-logo">⚡</div>
          <div className="header-text">
            <h1>Integra <span>Grupo Alerta</span></h1>
            <p>Prueba Técnica — Desarrollador Jr.</p>
          </div>
          <div className="header-badge">v1.0</div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="tab-nav">
        <div className="tab-nav-inner">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              id={`tab-${tab.id}`}
            >
              <span className="tab-icon">{tab.icon}</span>
              {tab.label}
              <span className="tab-number">{tab.num}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main style={{ flex: 1 }}>
        <div className="tab-content">
          {activeTab === 'xml' && <XMLProcessor />}
          {activeTab === 'csv' && <CSVAnalyzer />}
          {activeTab === 'records' && <RecordsHistory />}
        </div>
      </main>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid var(--border)',
        padding: '14px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-secondary)',
        fontSize: '0.75rem',
        color: 'var(--text-muted)'
      }}>
        <span>Prueba Técnica · Integra Grupo Alerta · {new Date().getFullYear()}</span>
        <span>React + TypeScript + Firebase Firestore</span>
      </footer>
    </div>
  );
}
