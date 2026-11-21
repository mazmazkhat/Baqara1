import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../state.jsx';
import { ErrorMsg, Loading, PinInput } from '../components/ui.jsx';

const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

function LangSwitch() {
  const { locale, setGuestLocale } = useApp();
  return (
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      <div className="seg" role="group" aria-label="Language">
        <button type="button" aria-pressed={locale === 'en'} onClick={() => setGuestLocale('en')}>English</button>
        <button type="button" aria-pressed={locale === 'ar'} onClick={() => setGuestLocale('ar')}>العربية</button>
      </div>
    </div>
  );
}

function AuthFrame({ title, sub, children }) {
  const { t } = useApp();
  return (
    <main className="auth">
      <LangSwitch />
      <div className="logo"><img src="/icon.svg" alt="" /></div>
      <h1>{title}</h1>
      {sub && <p className="sub">{sub}</p>}
      <div className="card">{children}</div>
      <p className="footer-note">{t('private_note')}</p>
    </main>
  );
}

export function Login() {
  const { t, refresh } = useApp();
  const [loginName, setLoginName] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  useEffect(() => { api('/setup/status').then((r) => setNeedsSetup(r.needsSetup)).catch(() => {}); }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { loginName: loginName.trim().toLowerCase(), pin } });
      await refresh();
    } catch (err) { setError(err); setPin(''); } finally { setBusy(false); }
  }

  return (
    <AuthFrame title={t('signin_title')} sub={t('signin_sub')}>
      <form onSubmit={submit} noValidate>
        <label className="field"><span>{t('login_name')}</span>
          <input name="loginName" autoComplete="username" autoCapitalize="none" spellCheck={false} dir="ltr" value={loginName} onChange={(e) => setLoginName(e.target.value)} required />
        </label>
        <label className="field"><span>{t('pin')}</span><PinInput id="pin" value={pin} onChange={setPin} /></label>
        <ErrorMsg error={error} />
        <button className="btn primary block" disabled={busy || !loginName || pin.length < 4}>{busy ? t('signing_in') : t('signin')}</button>
      </form>
      <p className="muted small" style={{ marginBottom: 0 }}>{t('signin_help')}</p>
      {needsSetup && <p className="small"><Link to="/setup">{t('setup_title')} →</Link></p>}
    </AuthFrame>
  );
}

export function Setup() {
  const { t, refresh, locale } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ setupCode: '', familyName: '', displayName: '', loginName: '', pin: '', pin2: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  useEffect(() => { api('/setup/status').then(setStatus).catch(setError); }, []);
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: typeof v === 'string' ? v : v.target.value }));

  if (!status && !error) return <Loading />;
  if (status && !status.needsSetup) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    if (f.pin !== f.pin2) return setError({ code: 'pins_differ_local' });
    setBusy(true); setError(null);
    try {
      await api('/setup', { method: 'POST', body: { ...f, loginName: f.loginName.trim().toLowerCase(), timezone: deviceTz(), locale } });
      await refresh();
      nav('/settings', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <AuthFrame title={t('setup_title')} sub={t('setup_sub')}>
      <form onSubmit={submit} noValidate>
        <label className="field"><span>{t('setup_code')}</span><input dir="ltr" autoComplete="off" value={f.setupCode} onChange={set('setupCode')} /><small>{t('setup_code_help')}</small></label>
        <label className="field"><span>{t('family_name')}</span><input value={f.familyName} onChange={set('familyName')} maxLength={60} /></label>
        <label className="field"><span>{t('your_name')}</span><input value={f.displayName} onChange={set('displayName')} maxLength={40} /></label>
        <label className="field"><span>{t('choose_login')}</span><input dir="ltr" autoCapitalize="none" autoComplete="username" value={f.loginName} onChange={set('loginName')} /><small>{t('login_hint')}</small></label>
        <label className="field"><span>{t('choose_pin')}</span><PinInput value={f.pin} onChange={set('pin')} autoComplete="new-password" /><small>{t('pin_hint_admin')}</small></label>
        <label className="field"><span>{t('pin_again')}</span><PinInput value={f.pin2} onChange={set('pin2')} autoComplete="new-password" /></label>
        {error?.code === 'pins_differ_local' ? <div className="alert error" role="alert">{t('pins_differ')}</div> : <ErrorMsg error={error} />}
        <button className="btn primary block" disabled={busy}>{t('create_family')}</button>
      </form>
    </AuthFrame>
  );
}

export function Invite() {
  const { token } = useParams();
  const { t, refresh, locale, me } = useApp();
  const nav = useNavigate();
  const [info, setInfo] = useState(undefined);
  const [loginName, setLoginName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api(`/invite/${encodeURIComponent(token)}`).then((r) => {
      setInfo(r);
      setLoginName(r.loginName || r.displayName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '').slice(0, 20));
    }).catch(() => setInfo(null));
  }, [token]);

  if (info === undefined) return <Loading />;
  if (info === null) {
    return (
      <AuthFrame title={t('invite_invalid_title')} sub={t('invite_invalid_sub')}>
        <Link className="btn block" to="/">{me ? t('nav_home') : t('signin')}</Link>
      </AuthFrame>
    );
  }
  const isReset = info.purpose === 'reset';
  const adminPin = info.role === 'admin';

  async function submit(e) {
    e.preventDefault();
    if (pin !== pin2) return setError({ code: 'pins_differ_local' });
    setBusy(true); setError(null);
    try {
      await api(`/invite/${encodeURIComponent(token)}/accept`, { method: 'POST', body: { loginName: loginName.trim().toLowerCase(), pin, timezone: deviceTz(), locale } });
      await refresh();
      nav('/', { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <AuthFrame
      title={t(isReset ? 'reset_title' : 'invite_title', { name: info.displayName })}
      sub={isReset ? t('reset_sub') : t('invite_sub', { family: info.familyName })}
    >
      <form onSubmit={submit} noValidate>
        {!isReset && (
          <label className="field"><span>{t('choose_login')}</span>
            <input dir="ltr" autoCapitalize="none" autoComplete="username" spellCheck={false} value={loginName} onChange={(e) => setLoginName(e.target.value)} />
            <small>{t('login_hint')}</small>
          </label>
        )}
        {isReset && <input type="hidden" autoComplete="username" value={info.loginName || ''} readOnly />}
        <label className="field"><span>{t('choose_pin')}</span><PinInput value={pin} onChange={setPin} autoComplete="new-password" /><small>{t(adminPin ? 'pin_hint_admin' : 'pin_hint')}</small></label>
        <label className="field"><span>{t('pin_again')}</span><PinInput value={pin2} onChange={setPin2} autoComplete="new-password" /></label>
        {error?.code === 'pins_differ_local' ? <div className="alert error" role="alert">{t('pins_differ')}</div> : <ErrorMsg error={error} />}
        <button className="btn primary block" disabled={busy || pin.length < 4}>{isReset ? t('set_pin') : t('join_family')}</button>
      </form>
    </AuthFrame>
  );
}
