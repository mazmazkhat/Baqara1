import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../state.jsx';
import { ICheck } from '../icons.jsx';

/** "Mark today complete" button with a gentle confirmation and undo. */
export function CompleteButton({ onChange, block = true }) {
  const { me, t, refresh, showToast } = useApp();
  const [busy, setBusy] = useState(false);
  const done = me.stats.doneToday;

  async function toggle() {
    setBusy(true);
    try {
      if (done) {
        await api('/completions/today', { method: 'DELETE' });
      } else {
        const r = await api('/completions/today', { method: 'POST' });
        showToast(r.finishedSurah ? t('enc_finished_surah') : t('marked_done'));
      }
      await refresh();
      onChange?.();
    } catch (e) {
      showToast(t.err(e.code));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="row" style={{ gap: 8 }}>
        <span className={`btn done ${block ? 'block' : ''}`} role="status"><ICheck />{t('completed_today')}</span>
        <button className="btn ghost small" onClick={toggle} disabled={busy}>{t('undo')}</button>
      </div>
    );
  }
  return (
    <button className={`btn primary ${block ? 'block' : ''}`} onClick={toggle} disabled={busy}>
      <ICheck />{t('mark_complete')}
    </button>
  );
}

export function encouragement(t, done, total) {
  if (total > 0 && done >= total) return t('enc_all');
  if (done > 0) return t('enc_some', { done, total });
  return t('enc_none');
}
