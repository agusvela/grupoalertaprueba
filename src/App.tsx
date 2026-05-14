import { useState } from 'react';
import XMLProcessor from './components/XMLProcessor';
import CSVAnalyzer from './components/CSVAnalyzer';
import RecordsHistory from './components/RecordsHistory';

type Tab = 'xml' | 'csv' | 'records';

const TABS: { id: Tab; label: string; num: string }[] = [
  { id: 'xml',     label: 'Procesador XML',        num: '01' },
  { id: 'csv',     label: 'Analisis CSV / Excel',  num: '02' },
  { id: 'records', label: 'Registros e Historial', num: '03' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('xml');

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="header-logo">
            <svg viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" rx="1"/>
              <rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
              <rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
          </div>
          <span className="header-brand">Integra Grupo Alerta</span>
          <div className="header-sep" />
          <span className="header-subtitle">Prueba Tecnica — Desarrollador Jr.</span>
          <span className="header-version">v1.0.0</span>
        </div>
      </header>

      <nav className="tab-nav">
        <div className="tab-nav-inner">
          {TABS.map(tab => (
            <button
              key={tab.id}
              id={`tab-${tab.id}`}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              <span className="tab-num">{tab.num}</span>
            </button>
          ))}
        </div>
      </nav>

      <main style={{ flex: 1 }}>
        <div className="tab-content">
          {activeTab === 'xml'     && <XMLProcessor />}
          {activeTab === 'csv'     && <CSVAnalyzer />}
          {activeTab === 'records' && <RecordsHistory />}
        </div>
      </main>

      <footer className="app-footer">
        <span>Integra Grupo Alerta &mdash; Prueba Tecnica &copy; {new Date().getFullYear()}</span>
        <span>React 18 &middot; TypeScript &middot; Firebase Firestore</span>
      </footer>
    </div>
  );
}
