import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../state.jsx';
import { ErrorMsg } from './ui.jsx';
import { pushStatus, turnOnPush, turnOffPush, refreshPushSubscription } from '../push.js';

const BANNER_KEY = 'bf_notif_banner_dismissed';
const readPref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

/** Sunday..Saturday short names in the interface language. */
function dayNames(t) {
  return Array.from({ length: 7 }, (_, i) => t.dateFmt(`2026-11-0${i + 1}`, { weekday: 'short' })); // 1 Nov 2026 is a Sunday
}

function DaysPicker({ value, onChange, t, label }) {
  const set = new Set((value || '').split(',').filter(Boolean).map(Number));
  const toggle = (d) => {
    const next = new Set(set);
    if (next.has(d)) next.delete(d); else next.add(d);
    onChange([...next].sort().join(','));
  };
  return (
    <div className="days" role="group" aria-label={label}>
      {dayNames(t).map((name, d) => (
        <button key={d} type="button" aria-pressed={set.has(d)} onClick={() => toggle(d)}>{name}</button>
      ))}
    </div>
  );
}

/** This phone: turn notifications on/off, or explain what is needed. */
export function DeviceNotifications({ onChange }) {
  const { t, showToast } = useApp();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushStatus().then(setStatus).catch(() => setStatus('unsupported')); }, []);

  async function run(fn) {
    setBusy(true);
    try { const s = await fn(); setStatus(s); onChange?.(s); } catch (e) { showToast(t.err(e.code)); } finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    try { await api('/push/test', { method: 'POST' }); showToast(t('notif_test_sent')); } catch (e) { showToast(t.err(e.code)); } finally { setBusy(false); }
  }

  if (!status) return <div className="skeleton" style={{ height: 48 }} />;
  if (status === 'ios-install') return <p className="alert ok" style={{ margin: 0 }}>{t('notif_ios_install')}</p>;
  if (status === 'unsupported') return <p className="muted" style={{ margin: 0 }}>{t('notif_unsupported')}</p>;
  if (status === 'denied') return <p className="alert error" style={{ margin: 0 }}>{t('notif_denied')}</p>;
  if (status === 'off') {
    return (
      <div>
        <p className="muted" style={{ marginTop: 0 }}>{t('notif_off')}</p>
        <button className="btn primary" disabled={busy} onClick={() => run(turnOnPush)}>🔔 {t('notif_turn_on')}</button>
      </div>
    );
  }
  return (
    <div>
      <p style={{ marginTop: 0 }}><b>✓ {t('notif_on')}</b></p>
      <div className="row wrap">
        <button className="btn" disabled={busy} onClick={test}>{t('notif_test')}</button>
        <button className="btn ghost" disabled={busy} onClick={() => run(turnOffPush)}>{t('notif_turn_off')}</button>
      </div>
    </div>
  );
}

/** My own reminder choices. */
export function MyReminders() {
  const { t, showToast } = useApp();
  const [r, setR] = useState(null);
  const [error, setError] = useState(null);
  const load = () => api('/reminders').then(setR).catch(setError);
  useEffect(() => { load(); refreshPushSubscription(); }, []);

  async function save(patch) {
    setR((x) => ({ ...x, mine: { ...x.mine, ...patch } }));
    try { await api('/reminders/me', { method: 'PUT', body: patch }); showToast(t('saved')); } catch (e) { showToast(t.err(e.code)); load(); }
  }

  if (error) return <ErrorMsg error={error} />;
  if (!r) return <div className="skeleton" style={{ height: 120 }} />;
  const m = r.mine;
  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <h3>{t('my_reminder')}</h3>
      <label className="toggle"><input type="checkbox" checked={m.enabled} onChange={(e) => save({ enabled: e.target.checked })} /><span>{t('rem_enabled')}</span></label>
      {m.enabled && (
        <>
          <div className="choice-extra" style={{ margin: 0 }}>
            <label className="toggle"><input type="radio" name="remtime" checked={m.useFamilyTime} onChange={() => save({ useFamilyTime: true })} /><span>{t('rem_family_time', { time: r.family.time })}</span></label>
            <label className="toggle"><input type="radio" name="remtime" checked={!m.useFamilyTime} onChange={() => save({ useFamilyTime: false, time: m.time })} /><span>{t('rem_own_time')}</span></label>
            {!m.useFamilyTime && <input type="time" className="time-input" value={m.time} onChange={(e) => e.target.value && save({ time: e.target.value })} aria-label={t('rem_own_time')} />}
          </div>
          <div>
            <p className="small" style={{ margin: '0 0 6px', fontWeight: 600 }}>{t('rem_quiet')}</p>
            <DaysPicker value={m.quietDays ?? r.family.quietDays} onChange={(v) => save({ quietDays: v })} t={t} label={t('rem_quiet')} />
          </div>
          <label className="toggle"><input type="checkbox" checked={m.followup} onChange={(e) => save({ followup: e.target.checked })} /><span>{t('rem_followup')}</span></label>
          {m.followup && (
            <div className="choice-extra row" style={{ margin: 0 }}>
              <span className="small">{t('rem_followup_at')}</span>
              <input type="time" className="time-input" value={m.followupTime} onChange={(e) => e.target.value && save({ followupTime: e.target.value })} aria-label={t('rem_followup')} />
            </div>
          )}
        </>
      )}
      <label className="toggle"><input type="checkbox" checked={m.celebrate} onChange={(e) => save({ celebrate: e.target.checked })} /><span>{t('rem_celebrate')}</span></label>
      <p className="muted small" style={{ margin: 0 }}>{t('rem_note', { tz: r.timezone.replaceAll('_', ' ') })}</p>
    </div>
  );
}

/** Administrator: the family's default reminder and the wake-up link for free hosting. */
export function FamilyReminders() {
  const { t, showToast } = useApp();
  const [r, setR] = useState(null);
  const [msg, setMsg] = useState('');
  const [wake, setWake] = useState(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    api('/reminders').then((x) => { setR(x.family); setMsg(x.family.message); }).catch(() => {});
    api('/admin/wakeup').then(setWake).catch(() => {});
  }, []);
  async function save(patch) {
    setR((x) => ({ ...x, ...patch }));
    try { await api('/admin/reminders', { method: 'PUT', body: patch }); showToast(t('saved')); } catch (e) { showToast(t.err(e.code)); }
  }
  if (!r) return <div className="skeleton" style={{ height: 120 }} />;
  return (
    <div className="stack">
      <h3 style={{ marginTop: 22 }}>{t('fam_reminder')}</h3>
      <label className="toggle"><input type="checkbox" checked={r.enabled} onChange={(e) => save({ enabled: e.target.checked })} /><span>{t('fam_rem_enabled')}</span></label>
      <div className="grid2">
        <label className="field" style={{ margin: 0 }}><span>{t('fam_rem_time')}</span><input type="time" value={r.time} onChange={(e) => e.target.value && save({ time: e.target.value })} /></label>
        <label className="field" style={{ margin: 0 }}><span>{t('fam_rem_followup')}</span><input type="time" value={r.followupTime} onChange={(e) => e.target.value && save({ followupTime: e.target.value })} /></label>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); save({ message: msg.trim() }); }}>
        <label className="field" style={{ flex: 1, margin: 0 }}><span>{t('fam_rem_message')}</span><input value={msg} maxLength={140} placeholder={t('fam_rem_message_ph')} onChange={(e) => setMsg(e.target.value)} /></label>
        <button className="btn" style={{ alignSelf: 'flex-end' }} disabled={msg.trim() === r.message}>{t('save')}</button>
      </form>
      <div>
        <p className="small" style={{ margin: '0 0 6px', fontWeight: 600 }}>{t('rem_quiet')}</p>
        <DaysPicker value={r.quietDays} onChange={(v) => save({ quietDays: v })} t={t} label={t('rem_quiet')} />
      </div>
      {wake && (
        <div className="wakeup">
          <h3>{t('wakeup_title')}</h3>
          <p className="small" style={{ marginTop: 0 }}>{t('wakeup_help')}</p>
          <ol className="small">
            <li>{t('wakeup_step1')}</li>
            <li>{t('wakeup_step2')}</li>
            <li>{t('wakeup_step3')}</li>
          </ol>
          <div className="linkbox">
            <input readOnly value={wake.url} onFocus={(e) => e.target.select()} aria-label={t('wakeup_title')} />
            <button className="btn small" onClick={async () => { try { await navigator.clipboard.writeText(wake.url); setCopied(true); } catch { /* select manually */ } }}>{copied ? t('copied') : t('copy')}</button>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            {t('wakeup_secret')} {wake.lastWakeup ? t('wakeup_last', { d: new Date(wake.lastWakeup).toLocaleString(t.locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) }) : t('wakeup_never')}
          </p>
        </div>
      )}
    </div>
  );
}

/** A small, dismissible prompt on Home for people who have not turned notifications on yet. */
export function NotificationBanner() {
  const { t, showToast } = useApp();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (readPref(BANNER_KEY)) return;
    pushStatus().then((s) => setShow(s === 'off' || s === 'ios-install')).catch(() => {});
  }, []);
  if (!show) return null;
  const dismiss = () => { writePref(BANNER_KEY, '1'); setShow(false); };
  return (
    <section className="card notif-banner" aria-live="polite">
      <b>🔔 {t('notif_banner')}</b>
      <DeviceNotifications onChange={(s) => { if (s === 'on') { showToast(t('notif_on')); dismiss(); } }} />
      <button className="btn ghost small" onClick={dismiss} style={{ marginTop: 6 }}>{t('not_now')}</button>
    </section>
  );
}
