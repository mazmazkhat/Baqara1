import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../state.jsx';
import { Loading, ErrorState } from '../components/ui.jsx';

function MonthCalendar({ ym, doneSet, today, t }) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = first.getUTCDay();
  const dows = Array.from({ length: 7 }, (_, i) => t.dateFmt(`2026-11-${String(1 + i).padStart(2, '0')}`, { weekday: 'narrow' })); // 1 Nov 2026 is a Sunday
  const cells = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`)];
  return (
    <div className="cal" role="grid">
      {dows.map((d, i) => <div key={i} className="dow">{d}</div>)}
      {cells.map((d, i) => d === null ? <div key={i} className="day blank" /> : (
        <div key={d} role="gridcell" className={`day ${doneSet.has(d) ? 'done' : ''} ${d === today ? 'today' : ''}`}
          aria-label={`${t.dateFmt(d, { day: 'numeric', month: 'long' })}${doneSet.has(d) ? ' ✓' : ''}`}>
          {t.num(Number(d.slice(8)))}
        </div>
      ))}
    </div>
  );
}

export default function History() {
  const { t } = useApp();
  const [h, setH] = useState(null);
  const [error, setError] = useState(null);
  const [ym, setYm] = useState(null);
  const load = () => { setError(null); api('/history').then((r) => { setH(r); setYm((v) => v || r.stats.today.slice(0, 7)); }).catch(setError); };
  useEffect(load, []);

  if (error) return <div className="shell"><ErrorState error={error} onRetry={load} /></div>;
  if (!h) return <div className="shell"><Loading /></div>;
  const s = h.stats;
  const doneSet = new Set(h.completions.map((c) => c.local_date));
  const shift = (n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setYm(d.toISOString().slice(0, 7)); };

  return (
    <div className="shell">
      <h1>{t('history_title')}</h1>
      <div className="grid2 grid4" style={{ marginTop: 16 }}>
        <div className="stat"><b>{t.num(s.streak)}</b><span>{t('streak')}</span></div>
        <div className="stat"><b>{t.num(s.totalDays)}</b><span>{t('total_days')}</span></div>
        <div className="stat"><b>{t.num(s.versesRead)}</b><span>{t('verses_read')}</span></div>
        <div className="stat"><b>{t.num(s.cyclesCompleted)}</b><span>{t('full_readings')}</span></div>
      </div>
      <p className="muted">{s.notMarkedLast30 > 0 ? t('gentle_missed', { n: s.notMarkedLast30 }) : t('gentle_missed_none')}</p>

      <section className="card">
        <div className="row between" style={{ marginBottom: 10 }}>
          <button className="btn icon" onClick={() => shift(-1)} aria-label="Previous month">‹</button>
          <h2 style={{ margin: 0 }}>{t.dateFmt(`${ym}-01`, { month: 'long', year: 'numeric' })}</h2>
          <button className="btn icon" onClick={() => shift(1)} aria-label="Next month" disabled={ym >= s.today.slice(0, 7)}>›</button>
        </div>
        <MonthCalendar ym={ym} doneSet={doneSet} today={s.today} t={t} />
      </section>

      <section className="card">
        <h2>{t('recent')}</h2>
        {h.completions.length === 0 ? <p className="muted">{t('no_history')}</p> : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {h.completions.slice(0, 10).map((c) => (
              <li key={c.local_date} className="row between" style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                <span>{t.dateFmt(c.local_date, { weekday: 'long', day: 'numeric', month: 'short' })}</span>
                <span className="muted small">{t('verses_range', { from: c.from_verse, to: c.to_verse })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>{t('bookmarks')}</h2>
        {h.bookmarks.length === 0 ? <p className="muted">{t('no_bookmarks')}</p> : (
          <div className="row wrap" style={{ gap: 8 }}>{h.bookmarks.map((b) => <Link key={b.verse} className="btn small" to="/read">{t('verse_n', { n: b.verse })}</Link>)}</div>
        )}
      </section>
    </div>
  );
}
