import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../state.jsx';
import { Avatar, Bar } from './ui.jsx';
import { ICheck, IBook } from '../icons.jsx';

/** 48 small page cells, filled when read today. */
export function PagesStrip({ read, total = 48, t }) {
  const set = new Set(read);
  return (
    <div className="pages-strip" role="img" aria-label={t('pages_read_today', { n: set.size, t: total })}>
      {Array.from({ length: total }, (_, i) => i + 2).map((p) => <i key={p} className={set.has(p) ? 'read' : ''} title={t('page_n', { p })} />)}
    </div>
  );
}

/** Today's family goal: the six parts of Al-Baqarah, taken and read by family members. */
export function TodayParts({ data, setData }) {
  const { me, t, showToast, refresh } = useApp();
  const [busy, setBusy] = useState(null);
  const isAdmin = me.user.role === 'admin';

  async function act(key, path, method, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(key);
    try {
      setData(await api(path, { method }));
      if (path.endsWith('/done')) await refresh();
    } catch (e) {
      showToast(t.err(e.code));
      api('/parts/today').then(setData).catch(() => {});
    } finally { setBusy(null); }
  }

  const readPages = data.pagesReadToday.length;
  return (
    <section className={`card ${data.wholeSurahToday ? 'accent' : ''}`} aria-labelledby="goal-h">
      <h2 id="goal-h">{t('goal_title')}</h2>
      <p className="muted" style={{ marginTop: 0 }}>{data.wholeSurahToday ? <b style={{ color: 'var(--done)' }}>{t('whole_surah_today')}</b> : t('goal_sub')}</p>
      <div className="row between small muted"><span>{t('pages_read_today', { n: readPages, t: data.totalPages })}</span><span>{t.num(Math.round((readPages / data.totalPages) * 100))}%</span></div>
      <Bar value={(readPages / data.totalPages) * 100} label={t('goal_title')} />

      <div style={{ marginTop: 8 }}>
        {data.parts.map((p) => {
          const c = p.claim;
          const mine = c?.user.id === me.user.id;
          const k = (s) => `${p.number}-${s}`;
          return (
            <div className={`part-row ${mine ? 'mine' : ''}`} key={p.number} data-part={p.number}>
              {c ? <Avatar person={c.user} size="sm" done={c.done} /> : <span className="avatar sm empty" aria-hidden="true">{t.num(p.number)}</span>}
              <div className="info">
                <div><b>{t('part_n', { n: p.number })}</b> <span className="muted small">· {t('pages_range', { from: p.pageFrom, to: p.pageTo })}</span></div>
                <div className="small muted">
                  {c ? <>{c.user.displayName}{mine ? ` (${t('you')})` : ''}</> : t('available')}
                  {!c && data.myYesterday.includes(p.number) && <span className="pill" style={{ marginInlineStart: 6 }}>{t('yesterday_tag')}</span>}
                </div>
                {mine && (
                  <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                    <Link className="btn small" to={`/read?part=${p.number}`}><IBook />{t('read_part')}</Link>
                    {c.done ? (
                      <button className="btn small ghost" disabled={busy === k('undo')} onClick={() => act(k('undo'), `/parts/${p.number}/done`, 'DELETE')}>{t('undo')}</button>
                    ) : (
                      <>
                        <button className="btn small primary" disabled={busy === k('done')} onClick={() => act(k('done'), `/parts/${p.number}/done`, 'POST')}><ICheck />{t('mark_part_read')}</button>
                        <button className="btn small ghost" disabled={busy === k('give')} onClick={() => act(k('give'), `/parts/${p.number}/claim`, 'DELETE')}>{t('give_back')}</button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {!c && <button className="btn small primary" disabled={busy === k('take')} onClick={() => act(k('take'), `/parts/${p.number}/claim`, 'POST')}>{t('take')}</button>}
              {c && !mine && (c.done ? <span className="pill done"><ICheck />{t('read_today')}</span> : (
                isAdmin ? <button className="btn small ghost" onClick={() => act(k('free'), `/parts/${p.number}/claim`, 'DELETE', t('free_confirm', { n: p.number }))}>{t('free_part')}</button>
                  : <span className="pill">{t('not_yet')}</span>
              ))}
              {mine && c.done && <span className="pill done"><ICheck />{t('read_today')}</span>}
            </div>
          );
        })}
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>{t('parts_reset_note')}</p>
    </section>
  );
}
