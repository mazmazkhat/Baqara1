import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { api } from './api.js';
import { makeT } from './i18n.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

function readPref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

export function AppProvider({ children }) {
  const [me, setMe] = useState(undefined); // undefined = loading, null = signed out
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState(null);
  const [guestLocale, setGuestLocale] = useState(() => readPref('bf_locale', navigator.language?.startsWith('ar') ? 'ar' : 'en'));

  const refresh = useCallback(async () => {
    try {
      setLoadError(null);
      setMe(await api('/me'));
    } catch (e) {
      if (e.status === 401) setMe(null);
      else setLoadError(e);
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const locale = me?.user?.locale ?? guestLocale;
  const theme = me?.user?.theme ?? readPref('bf_theme', 'system');
  const t = useMemo(() => makeT(locale), [locale]);

  useEffect(() => {
    const html = document.documentElement;
    html.lang = locale;
    html.dir = locale === 'ar' ? 'rtl' : 'ltr';
    if (theme === 'system') html.removeAttribute('data-theme');
    else html.setAttribute('data-theme', theme);
    writePref('bf_theme', theme);
    writePref('bf_locale', locale);
    document.title = t('appName');
  }, [locale, theme, t]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => setToast(null), 3200);
  }, []);

  /** Optimistically patch the current user's settings and persist them. */
  const updateMe = useCallback(async (patch) => {
    setMe((m) => (m ? { ...m, user: { ...m.user, ...patch } } : m));
    await api('/me', { method: 'PATCH', body: patch });
  }, []);

  const value = { me, setMe, refresh, loadError, t, locale, setGuestLocale: (l) => { setGuestLocale(l); writePref('bf_locale', l); }, showToast, updateMe };
  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
    </Ctx.Provider>
  );
}
