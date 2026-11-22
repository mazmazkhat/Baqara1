import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../state.jsx';

/** Administrator: send a kind reminder to everyone who has not read yet today. */
export function NudgeButton() {
  const { me, t, showToast } = useApp();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (me.user.role !== 'admin') return null;

  const time = (iso) => new Date(iso).toLocaleTimeString(t.locale === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  async function openPanel() {
    setOpen(true);
    setInfo(null);
    try { setInfo(await api('/admin/nudge')); } catch (e) { showToast(t.err(e.code)); setOpen(false); }
  }
  async function send() {
    setBusy(true);
    try {
      const r = await api('/admin/nudge', { method: 'POST', body: { message: message.trim() } });
      showToast(r.sent ? t('nudge_sent', { n: r.sent }) : t('nudge_none'));
      setOpen(false);
      setMessage('');
    } catch (e) {
      if (e.code === 'nudge_too_soon') setInfo((x) => ({ ...x, nextAllowedAt: e.body.retryAt }));
      showToast(e.code === 'nudge_too_soon' ? t('nudge_wait', { time: time(e.body.retryAt) }) : t.err(e.code));
    } finally { setBusy(false); }
  }

  if (!open) {
    return <button className="btn block nudge-btn" onClick={openPanel}>🤍 {t('nudge_button')}</button>;
  }
  return (
    <section className="card nudge-panel" aria-labelledby="nudge-h">
      <h2 id="nudge-h">🤍 {t('nudge_title')}</h2>
      {!info ? <div className="skeleton" style={{ height: 60 }} /> : (
        <div className="stack">
          {info.recipients.length ? (
            <p style={{ margin: 0 }}>{t('nudge_to')} <b>{info.recipients.join(t.locale === 'ar' ? '، ' : ', ')}</b></p>
          ) : <p className="alert ok" style={{ margin: 0 }}>{t('nudge_nobody')}</p>}
          {info.alreadyRead > 0 && <p className="muted small" style={{ margin: 0 }}>{t('nudge_already', { n: info.alreadyRead })}</p>}
          {info.withoutNotifications.length > 0 && (
            <p className="muted small" style={{ margin: 0 }}>{t('nudge_no_device', { names: info.withoutNotifications.join(t.locale === 'ar' ? '، ' : ', ') })}</p>
          )}
          {info.recipients.length > 0 && (
            <>
              <label className="field" style={{ margin: 0 }}><span>{t('nudge_message')}</span>
                <textarea rows={2} maxLength={140} value={message} placeholder={t('nudge_placeholder')} onChange={(e) => setMessage(e.target.value)} />
                <small>{t('nudge_signed', { name: me.user.displayName })}</small>
              </label>
              {info.nextAllowedAt && <p className="muted small" style={{ margin: 0 }}>{t('nudge_wait', { time: time(info.nextAllowedAt) })}</p>}
            </>
          )}
          <div className="row">
            {info.recipients.length > 0 && <button className="btn primary" disabled={busy || Boolean(info.nextAllowedAt)} onClick={send}>{t('nudge_send')}</button>}
            <button className="btn ghost" onClick={() => setOpen(false)}>{t('close')}</button>
          </div>
        </div>
      )}
    </section>
  );
}
