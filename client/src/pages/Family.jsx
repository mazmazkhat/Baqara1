import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../state.jsx';
import { Avatar, Bar, Loading, ErrorState } from '../components/ui.jsx';
import { encouragement } from '../components/complete.jsx';
import { ICheck } from '../icons.jsx';

export default function Family() {
  const { t, me } = useApp();
  const [d, setD] = useState(null);
  const [error, setError] = useState(null);
  const load = () => { setError(null); api('/family/dashboard').then(setD).catch(setError); };
  useEffect(load, []);

  if (error) return <div className="shell"><ErrorState error={error} onRetry={load} /></div>;
  if (!d) return <div className="shell"><Loading /></div>;
  const active = Math.max(1, d.today.active);
  const allDone = d.today.done >= d.today.active && d.today.active > 0;

  return (
    <div className="shell">
      <h1>{t('family_title')}</h1>
      <p className="sub">{d.family.name}</p>

      <section className={`card ${allDone ? 'accent' : ''}`} aria-live="polite">
        <h2>{t('family_done', { done: d.today.done, total: d.today.active })}</h2>
        <p style={{ margin: 0 }}>{encouragement(t, d.today.done, d.today.active)}</p>
      </section>

      <SharedReading shared={d.shared} t={t} me={me} />

      <section className="card" aria-label={t('members')}>
        {d.members.map((m) => (
          <div className="member" key={m.id}>
            <Avatar person={m} done={m.doneToday} faded={m.status === 'invited'} />
            <div className="info">
              <div className="row between">
                <span className="name">{m.displayName}{m.id === me.user.id ? <span className="muted small"> ({t('you')})</span> : ''}</span>
                {m.status === 'invited' ? <span className="pill">{t('invited')}</span>
                  : m.doneToday ? <span className="pill done"><ICheck />{t('read_today')}</span>
                    : <span className="pill">{t('not_yet')}</span>}
              </div>
              {m.status === 'active' && <div style={{ marginTop: 8 }}><Bar value={m.portionPercent} label={`${m.displayName} — ${t('portion_progress')}`} /></div>}
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>{t('this_week')}</h2>
        <div className="week" role="list">
          {d.week.map((day) => (
            <div className="col" key={day.date} role="listitem" aria-label={`${t.dateFmt(day.date)}: ${t('day_count', { n: day.count, t: d.today.active })}`}>
              <span className="small">{t.num(day.count)}</span>
              <i className={day.count ? '' : 'empty'} style={{ height: `${Math.max(6, (day.count / active) * 80)}px` }} />
              <span>{t.dateFmt(day.date, { weekday: 'narrow' })}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>{t('last_30')}</h2>
        <div className="month" role="list">
          {d.month.map((day) => (
            <i key={day.date} role="listitem" title={`${t.dateFmt(day.date)} · ${t('day_count', { n: day.count, t: d.today.active })}`}
              aria-label={`${t.dateFmt(day.date)}: ${t('day_count', { n: day.count, t: d.today.active })}`}
              style={day.count ? { background: 'var(--green)', opacity: 0.25 + 0.75 * Math.min(1, day.count / active) } : undefined} />
          ))}
        </div>
        <div className="legend"><i style={{ background: 'var(--surface-2)' }} />0 <i style={{ background: 'var(--green)', opacity: 0.4 }} /> <i style={{ background: 'var(--green)' }} />{t.num(d.today.active)}</div>
      </section>

      <section className="card">
        <h2>{t('together_totals')}</h2>
        <div className="grid2 grid4">
          <div className="stat"><b>{t.num(d.totals.daysAllTogether)}</b><span>{t('days_all_together')}</span></div>
          <div className="stat"><b>{t.num(d.totals.readingDays)}</b><span>{t('reading_days')}</span></div>
          <div className="stat"><b>{t.num(d.totals.versesRead)}</b><span>{t('family_verses')}</span></div>
          <div className="stat"><b>{t.num(d.shared.wholeSurahDays)}</b><span>{t('whole_surah_days')}</span></div>
        </div>
      </section>
    </div>
  );
}

function SharedReading({ shared, t, me }) {
  const read = new Set(shared.pagesReadToday);
  const pages = Array.from({ length: shared.totalPages }, (_, i) => i + 2);
  return (
    <section className={`card ${shared.wholeSurahToday ? 'accent' : ''}`} aria-labelledby="shared-h">
      <h2 id="shared-h">{t('shared_title')}</h2>
      <p style={{ margin: 0 }}>{shared.wholeSurahToday ? <b>{t('whole_surah_today')}</b> : t('pages_read_today', { n: read.size, t: shared.totalPages })}</p>
      <div className="pages-strip" role="img" aria-label={t('pages_read_today', { n: read.size, t: shared.totalPages })}>
        {pages.map((p) => <i key={p} className={read.has(p) ? 'read' : ''} title={t('page_n', { p })} />)}
      </div>
      <div style={{ marginTop: 10 }}>
        {shared.parts.map((p) => (
          <div className="part-row" key={p.number}>
            {p.owner ? <Avatar person={p.owner} size="sm" done={p.owner.doneToday} /> : <span className="avatar sm empty" aria-hidden="true">?</span>}
            <div className="info">
              <div><b>{t('part_n', { n: p.number })}</b> <span className="muted small">· {t('pages_range', { from: p.pageFrom, to: p.pageTo })}</span></div>
              <div className="small muted">{p.owner ? <>{p.owner.displayName}{p.owner.id === me.user.id ? ` (${t('you')})` : ''}</> : t('not_chosen')}</div>
            </div>
            {p.owner && (p.owner.doneToday ? <span className="pill done"><ICheck />{t('read_today')}</span> : <span className="pill">{t('not_yet')}</span>)}
          </div>
        ))}
      </div>
    </section>
  );
}
