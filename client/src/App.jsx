import { useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, Link, useLocation } from 'react-router-dom';
import { useApp } from './state.jsx';
import { IHome, IBook, IFamily, ICal, ICog } from './icons.jsx';
import { Loading, ErrorState } from './components/ui.jsx';
import { Login, Setup, Invite } from './pages/Auth.jsx';
import Home from './pages/Home.jsx';
import Reader from './pages/Reader.jsx';
import Family from './pages/Family.jsx';
import History from './pages/History.jsx';
import Settings from './pages/Settings.jsx';

function Shell({ children }) {
  const { t, me } = useApp();
  const { pathname } = useLocation();
  useEffect(() => { if (pathname !== '/read') window.scrollTo(0, 0); }, [pathname]);
  const tabs = [
    ['/', IHome, t('nav_home')],
    ['/read', IBook, t('nav_read')],
    ['/family', IFamily, t('nav_family')],
    ['/history', ICal, t('nav_history')],
    ['/settings', ICog, t('nav_settings')],
  ];
  return (
    <>
      <header className="topbar">
        <div className="pattern pattern-layer" />
        <div className="topbar-inner">
          <Link to="/" className="brand"><img src="/icon.svg" alt="" />{t('appName')}</Link>
          <span className="spacer" />
          <span className="muted small">{me.family.name}</span>
        </div>
      </header>
      <nav className="tabbar" aria-label="Main">
        {tabs.map(([to, Icon, label]) => (
          <NavLink key={to} to={to} end={to === '/'}><Icon /><span>{label}</span></NavLink>
        ))}
      </nav>
      <main id="main">{children}</main>
    </>
  );
}

export default function App() {
  const { me, loadError, refresh } = useApp();
  const loc = useLocation();

  if (loc.pathname.startsWith('/invite/')) return <Routes><Route path="/invite/:token" element={<Invite />} /></Routes>;
  if (me === undefined && loadError) return <ErrorState error={loadError} onRetry={refresh} />;
  if (me === undefined) return <Loading />;
  if (me === null) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/read" element={<Reader />} />
        <Route path="/family" element={<Family />} />
        <Route path="/history" element={<History />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
