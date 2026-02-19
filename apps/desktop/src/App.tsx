import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { EngineSetupDialog } from './components/setup/EngineSetupDialog'
import { LanguageSelector } from './components/LanguageSelector'
import { useNavigationStore } from './stores/navigation-store'

const DataEditorPage = lazy(() => import('./features/data-editor/DataEditorPage'))
const AnalysisPage = lazy(() => import('./features/analysis/AnalysisPage'))
const ResultsPage = lazy(() => import('./features/results/ResultsPage'))
const AboutPage = lazy(() => import('./features/about/AboutPage'))

function Sidebar() {
  const { t } = useTranslation();

  const navItems = [
    { to: '/', label: t('app.dataEditor'), icon: '📊' },
    { to: '/analysis', label: t('app.analysis'), icon: '🔬' },
    { to: '/results', label: t('app.results'), icon: '📈' },
    { to: '/about', label: t('app.about'), icon: '💬' },
  ];

  return (
    <aside className="sidebar w-16 lg:w-56 flex flex-col shrink-0" style={{ borderRight: '1px solid var(--color-sidebar-border)' }}>
      {/* Logo */}
      <div style={{
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-4)',
        borderBottom: '1px solid var(--color-sidebar-border)'
      }}>
        <span className="hidden lg:block text-subheading" style={{ color: 'var(--color-sidebar-text)', fontWeight: 'var(--font-weight-semibold)' }}>
          {t('app.title')}
        </span>
        <span className="lg:hidden" style={{ color: 'var(--color-sidebar-text)', fontWeight: 'var(--font-weight-bold)', fontSize: 'var(--font-size-lg)' }}>M</span>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: 'var(--space-4) var(--space-2)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {navItems.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `sidebar-nav-item ${isActive ? 'active' : ''}`}
            >
              <span style={{ fontSize: 'var(--font-size-base)' }}>{icon}</span>
              <span className="hidden lg:block">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div style={{ padding: 'var(--space-4)', borderTop: '1px solid var(--color-sidebar-border)' }}>
        <div className="hidden lg:block" style={{ marginBottom: 'var(--space-2)' }}>
          <LanguageSelector />
        </div>
        <p className="hidden lg:block text-micro" style={{ color: 'var(--color-sidebar-text-muted)' }}>v0.1.0</p>
      </div>
    </aside>
  )
}

function LoadingSpinner() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="animate-spin rounded-full h-8 w-8" style={{ borderWidth: '2px', borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent)' }} />
    </div>
  )
}

// Handles auto-navigation after analysis completes
function NavigationHandler() {
  const navigate = useNavigate()
  const pendingNavigation = useNavigationStore((state) => state.pendingNavigation)
  const clearPendingNavigation = useNavigationStore((state) => state.clearPendingNavigation)

  useEffect(() => {
    if (pendingNavigation) {
      navigate(pendingNavigation)
      clearPendingNavigation()
    }
  }, [pendingNavigation, navigate, clearPendingNavigation])

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <NavigationHandler />
      <EngineSetupDialog />
      <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Sidebar />

        <main className="main-content" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Suspense fallback={<LoadingSpinner />}>
            <Routes>
              <Route path="/" element={<DataEditorPage />} />
              <Route path="/analysis" element={<AnalysisPage />} />
              <Route path="/results" element={<ResultsPage />} />
              <Route path="/about" element={<AboutPage />} />
              {/* Legacy routes redirect to new Results page */}
              <Route path="/output" element={<Navigate to="/results" replace />} />
              <Route path="/syntax" element={<Navigate to="/results" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  )
}
