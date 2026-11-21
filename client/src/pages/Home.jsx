import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../state.jsx';
import { Avatar, Bar } from '../components/ui.jsx';
import { CompleteButton, encouragement } from '../components/complete.jsx';
import { IBook } from '../icons.jsx';

export default function Home() {
  const { me, t } = useApp();
  const s = me.stats;
  const [dash, setDash] = useState(null);
  const [dashErr, setDashErr] = useState(null);
  const load = () => api('/family/dashboard').then(setDash).catch(setDashErr);
  useEffect(() => { load(); }, [s.doneToday]);

  const started = s.position > 1 || s.versesRead > 0;
  const partial = s.plan.plan_type !== 'free' && s.plan.plan_type !== 'whole';

  return (
    <div className="shell">
      <h1>{t('greeting', { name: me.user.displayName })}</h1>
      <p className="sub">{t.dateFmt(s.today, { weekday: 'long', day: 'numeric', month: 'long' })}</p>

      <section className="card accent" aria-labelledby="today-h">
        <h2 id="today-h">{t('todays_reading')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{s.doneToday ? t('done_today') : t('not_yet_today')}</p>
        {partial && <p className="small" style={{ margin: '0 0 8px' }}><b>{t('verses_range', { from: s.portion.from, to: s.portion.to })}</b></p>}
        <div className="row between small muted"><span>{partial ? t('portion_progress') : t('surah_progress')}</span><span>{t.num(partial ? s.portion.percent : s.surahPercent)}%</span></div>
        <Bar value={partial ? s.portion.percent : s.surahPercent} label={t('portion_progress')} />
        <div className="stack" style={{ marginTop: 16 }}>
          <Link className="btn primary block" to="/read"><IBook />{started ? t('continue_from', { v: s.position }) : t('start_reading')}</Link>
          <CompleteButton />
        </div>
      </section>

      <section className="card" aria-labelledby="fam-h">
        <div className="row between"><h2 id="fam-h" style={{ margin: 0 }}>{t('family_today')}</h2><Link to="/family" className="small">{t('nav_family')} →</Link></div>
        {!dash && !dashErr && <div className="skeleton" style={{ height: 46 }} />}
        {dashErr && <p className="muted">{t.err(dashErr.code)}</p>}
        {dash && (
          <>
            <div className="row" style={{ margin: '14px 0 10px' }}>
              <div className="avatars">
                {dash.members.map((m) => <Avatar key={m.id} person={m} size="sm" done={m.doneToday} faded={m.status === 'invited'} />)}
              </div>
              <b>{t('family_done', { done: dash.today.done, total: dash.today.active })}</b>
            </div>
            <p style={{ margin: 0 }}>{encouragement(t, dash.today.done, dash.today.active)}</p>
          </>
        )}
      </section>

      <section className="grid2" aria-label={t('nav_history')}>
        <div className="stat"><b>{t.num(s.streak)}</b><span>{t('streak')}</span></div>
        <div className="stat"><b>{t.num(s.totalDays)}</b><span>{t('total_days')}</span></div>
      </section>

      <p className="footer-note">{t('disclaimer')}</p>
    </div>
  );
}
