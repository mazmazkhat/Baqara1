import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../state.jsx';
import { Avatar, ErrorMsg, PinInput } from '../components/ui.jsx';
import { IShare } from '../icons.jsx';

const COLORS = ['green', 'navy', 'gold', 'teal', 'rose', 'plum'];
const EMOJIS = ['', '🌙', '⭐', '🌿', '🌸', '🕊️', '🌳', '☀️', '💧', '📖', '🌷', '🍃'];
const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; } };
const allZones = () => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; } };

function Section({ title, children, note }) {
  return <section className="card"><h2>{title}</h2>{note && <p className="muted small" style={{ marginTop: -4 }}>{note}</p>}{children}</section>;
}

function TimeZoneSelect({ value, onChange, label }) {
  const zones = useMemo(() => { const z = allZones(); return z.includes(value) ? z : [value, ...z]; }, [value]);
  return <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>{zones.map((z) => <option key={z} value={z}>{z.replaceAll('_', ' ')}</option>)}</select>;
}

function Profile() {
  const { me, t, updateMe, showToast } = useApp();
  const [name, setName] = useState(me.user.displayName);
  const u = me.user;
  const save = (patch) => updateMe(patch).then(() => showToast(t('saved'))).catch((e) => showToast(t.err(e.code)));
  return (
    <Section title={t('profile')}>
      <div className="row" style={{ marginBottom: 14 }}><Avatar person={u} size="lg" /><b>{u.displayName}</b></div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (name.trim()) save({ displayName: name.trim() }); }}>
        <label className="field" style={{ flex: 1, margin: 0 }}><span>{t('display_name')}</span><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <button className="btn" style={{ alignSelf: 'flex-end' }} disabled={name.trim() === u.displayName}>{t('save')}</button>
      </form>
      <p style={{ fontWeight: 600, margin: '16px 0 6px' }}>{t('avatar')}</p>
      <div className="emojis" role="group" aria-label={t('avatar')}>
        {EMOJIS.map((e) => <button key={e || 'none'} type="button" aria-pressed={u.avatar === e} onClick={() => save({ avatar: e })} aria-label={e || t('none')}>{e || 'Aa'}</button>)}
      </div>
      <p style={{ fontWeight: 600, margin: '16px 0 6px' }}>{t('color')}</p>
      <div className="swatches" role="group" aria-label={t('color')}>
        {COLORS.map((c) => <button key={c} type="button" className={`c-${c}`} aria-pressed={u.avatarColor === c} aria-label={c} onClick={() => save({ avatarColor: c })} />)}
      </div>
    </Section>
  );
}

export function PartPicker({ value, onChange, parts, me, t }) {
  return (
    <div role="radiogroup" aria-label={t('choose_part')}>
      {parts.map((p) => {
        const mine = p.owner?.id === me.user.id;
        const taken = p.owner && !mine;
        return (
          <label key={p.number} className={`choice part-choice ${taken ? 'taken' : ''}`}>
            <input type="radio" name="part" value={p.number} checked={value === p.number} disabled={taken} onChange={() => onChange(p.number)} />
            <span style={{ flex: 1 }}>
              <b>{t('part_n', { n: p.number })}</b> · {t('pages_range', { from: p.pageFrom, to: p.pageTo })}
              <span className="muted small"> · {t('n_pages', { n: p.pages })}</span><br />
              <span className="muted small">{mine ? t('yours') : p.owner ? t('taken_by', { name: p.owner.displayName }) : t('available')}</span>
            </span>
            {p.owner && <Avatar person={p.owner} size="sm" />}
          </label>
        );
      })}
    </div>
  );
}

function Plan() {
  const { me, t, refresh, showToast } = useApp();
  const p = me.stats.plan;
  const [type, setType] = useState(p.plan_type);
  const [vpd, setVpd] = useState(p.verses_per_day || 20);
  const [days, setDays] = useState(p.days_total || 30);
  const [part, setPart] = useState(me.stats.part);
  const [parts, setParts] = useState(null);
  const [error, setError] = useState(null);
  const loadParts = () => api('/family/parts').then((r) => setParts(r.parts)).catch(setError);
  useEffect(() => { loadParts(); }, []);
  async function save(e) {
    e.preventDefault();
    setError(null);
    try {
      await api('/plan', { method: 'PUT', body: { planType: type, versesPerDay: Number(vpd), daysTotal: Number(days), part } });
      await refresh();
      loadParts();
      showToast(t('saved'));
    } catch (err) { setError(err); loadParts(); }
  }
  const opt = (value, title, desc, extra) => (
    <div key={value}>
      <label className="choice">
        <input type="radio" name="plan" value={value} checked={type === value} onChange={() => setType(value)} />
        <span style={{ flex: 1 }}><b>{title}</b><br /><span className="muted small">{desc}</span></span>
      </label>
      {type === value && extra && <div className="choice-extra">{extra}</div>}
    </div>
  );
  return (
    <Section title={t('reading_plan')}>
      <form onSubmit={save} id="plan">
        {opt('pages', t('plan_part'), t('plan_part_d'),
          parts ? <PartPicker value={part} onChange={setPart} parts={parts} me={me} t={t} /> : <span className="muted">{t('loading')}</span>)}
        {opt('free', t('plan_free'), t('plan_free_d'))}
        {opt('whole', t('plan_whole'), t('plan_whole_d'))}
        {opt('verses', t('plan_verses'), t('plan_verses_d'),
          <span className="row" style={{ marginTop: 8 }}><input type="number" min="1" max="286" value={vpd} onChange={(e) => setVpd(e.target.value)} style={{ maxWidth: 110 }} aria-label={t('per_day')} /> {t('per_day')}</span>)}
        {opt('days', t('plan_days'), t('plan_days_d'),
          <span className="row" style={{ marginTop: 8 }}><input type="number" min="1" max="365" value={days} onChange={(e) => setDays(e.target.value)} style={{ maxWidth: 110 }} aria-label={t('over_days')} /> {t('over_days')} ({t.num(Math.ceil(286 / Math.max(1, days)))} {t('per_day')})</span>)}
        <ErrorMsg error={error} />
        <button className="btn primary" disabled={type === 'pages' && !part}>{t('save')}</button>
      </form>
    </Section>
  );
}

function Display() {
  const { me, t, updateMe, showToast } = useApp();
  const u = me.user;
  const save = (patch) => updateMe(patch).catch((e) => showToast(t.err(e.code)));
  const tz = deviceTz();
  return (
    <Section title={t('display')}>
      <p style={{ fontWeight: 600, margin: '0 0 6px' }}>{t('language')}</p>
      <div className="seg" role="group" aria-label={t('language')}>
        <button aria-pressed={u.locale === 'en'} onClick={() => save({ locale: 'en' })}>English</button>
        <button aria-pressed={u.locale === 'ar'} onClick={() => save({ locale: 'ar' })}>العربية</button>
      </div>
      <p style={{ fontWeight: 600, margin: '16px 0 6px' }}>{t('theme')}</p>
      <div className="seg" role="group" aria-label={t('theme')}>
        {['system', 'light', 'dark'].map((th) => <button key={th} aria-pressed={u.theme === th} onClick={() => save({ theme: th })}>{t(`theme_${th}`)}</button>)}
      </div>
      <label className="field" style={{ marginTop: 16 }}><span>{t('quran_font_size')} — {t.num(Math.round(u.fontScale * 100))}%</span>
        <input type="range" min="0.8" max="2.2" step="0.1" value={u.fontScale} onChange={(e) => save({ fontScale: Number(e.target.value) })} style={{ width: '100%' }} />
      </label>
      <div className="quran" lang="ar" dir="rtl" style={{ fontSize: Math.round(30 * u.fontScale), textAlign: 'center' }} aria-hidden="true">سُورَةُ البَقَرَةِ</div>
      <label className="field" style={{ marginTop: 16 }}><span>{t('timezone')}</span>
        <TimeZoneSelect value={u.timezone} onChange={(z) => save({ timezone: z }).then(() => showToast(t('saved')))} label={t('timezone')} />
        <small>{t('timezone_help')}</small>
      </label>
      {tz && tz !== u.timezone && (
        <p className="small">{t('detected', { tz })} <button className="btn small" onClick={() => save({ timezone: tz })}>{t('use_detected')}</button></p>
      )}
    </Section>
  );
}

function Security() {
  const { me, t, showToast } = useApp();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState(null);
  async function submit(e) {
    e.preventDefault();
    setError(null);
    try {
      await api('/me/pin', { method: 'POST', body: { currentPin: cur, newPin: next } });
      setCur(''); setNext('');
      showToast(t('pin_changed'));
    } catch (err) { setError(err); }
  }
  return (
    <Section title={t('security')}>
      <form onSubmit={submit}>
        <input type="hidden" autoComplete="username" value={me.user.loginName} readOnly />
        <p className="small muted" style={{ marginTop: 0 }}>{t('login_name')}: <b dir="ltr">{me.user.loginName}</b></p>
        <div className="grid2">
          <label className="field"><span>{t('current_pin')}</span><PinInput value={cur} onChange={setCur} /></label>
          <label className="field"><span>{t('new_pin')}</span><PinInput value={next} onChange={setNext} autoComplete="new-password" /></label>
        </div>
        <small className="muted">{t(me.user.role === 'admin' ? 'pin_hint_admin' : 'pin_hint')}</small>
        <ErrorMsg error={error} />
        <div style={{ marginTop: 10 }}><button className="btn" disabled={cur.length < 4 || next.length < 4}>{t('change_pin')}</button></div>
      </form>
    </Section>
  );
}

function InviteLink({ invite, name, onDone }) {
  const { t } = useApp();
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}${invite.path}`;
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* select manually */ } };
  return (
    <div className="alert ok" role="status">
      <p style={{ marginTop: 0 }}>{t('invite_ready', { name })}</p>
      <div className="linkbox"><input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Invite link" /><button className="btn small" onClick={copy}>{copied ? t('copied') : t('copy')}</button></div>
      <div className="row" style={{ marginTop: 8 }}>
        {navigator.share && <button className="btn small" onClick={() => navigator.share({ title: t('appName'), text: t('invite_ready', { name }), url }).catch(() => {})}><IShare />{t('share')}</button>}
        <button className="btn ghost small" onClick={onDone}>{t('close')}</button>
      </div>
    </div>
  );
}

function Admin() {
  const { me, t, refresh, showToast } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [newName, setNewName] = useState('');
  const [invite, setInvite] = useState(null);
  const [famName, setFamName] = useState(me.family.name);
  const [editing, setEditing] = useState(null);
  const load = () => api('/admin/members').then(setData).catch(setError);
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api('/admin/members', { method: 'POST', body: { displayName: newName } });
      setInvite({ ...r.invite, name: newName });
      setNewName('');
      load();
    } catch (err) { setError(err); }
  }
  async function act(fn) { setError(null); try { await fn(); await load(); } catch (err) { setError(err); } }
  const saveFamily = (patch) => act(async () => { await api('/admin/family', { method: 'PATCH', body: patch }); await refresh(); showToast(t('saved')); });

  const full = data && data.members.length >= data.maxMembers;
  return (
    <Section title={t('admin')} note={t('admin_only_note')}>
      <h3>{t('family_settings')}</h3>
      <form className="row" onSubmit={(e) => { e.preventDefault(); saveFamily({ name: famName }); }}>
        <label className="field" style={{ flex: 1, margin: 0 }}><span>{t('family_name')}</span><input value={famName} maxLength={60} onChange={(e) => setFamName(e.target.value)} /></label>
        <button className="btn" style={{ alignSelf: 'flex-end' }}>{t('save')}</button>
      </form>
      <label className="field" style={{ marginTop: 14 }}><span>{t('family_timezone')}</span>
        <TimeZoneSelect value={me.family.timezone} onChange={(z) => saveFamily({ timezone: z })} label={t('family_timezone')} />
        <small>{t('family_tz_help')}</small>
      </label>

      <h3 style={{ marginTop: 22 }}>{t('members')} {data && <span className="muted small">· {t('members_count', { n: data.members.length, max: data.maxMembers })}</span>}</h3>
      <ErrorMsg error={error} />
      {invite && <InviteLink invite={invite} name={invite.name} onDone={() => setInvite(null)} />}
      {data?.members.map((m) => {
        const person = { displayName: m.display_name, avatar: m.avatar, avatarColor: m.avatar_color };
        return (
          <div className="member" key={m.id}>
            <Avatar person={person} faded={m.status === 'invited'} />
            <div className="info">
              {editing?.id === m.id ? (
                <form className="row" onSubmit={(e) => { e.preventDefault(); act(() => api(`/admin/members/${m.id}`, { method: 'PATCH', body: { displayName: editing.name } })).then(() => setEditing(null)); }}>
                  <input value={editing.name} maxLength={40} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label={t('rename')} autoFocus />
                  <button className="btn small">{t('save')}</button>
                  <button type="button" className="btn ghost small" onClick={() => setEditing(null)}>{t('cancel')}</button>
                </form>
              ) : (
                <>
                  <div className="name">{m.display_name}</div>
                  <div className="muted small">
                    {m.status === 'invited' ? t('status_invited') : <span dir="ltr">@{m.login_name}</span>} · {t(m.role === 'admin' ? 'role_admin' : 'role_member')}
                  </div>
                  <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                    <button className="btn small" onClick={() => setEditing({ id: m.id, name: m.display_name })}>{t('rename')}</button>
                    {m.id !== me.user.id && (
                      <button className="btn small" onClick={() => act(async () => { const r = await api(`/admin/members/${m.id}/invite`, { method: 'POST' }); setInvite({ ...r.invite, name: m.display_name }); })}>
                        {m.status === 'invited' ? t('new_link') : t('new_link_reset')}
                      </button>
                    )}
                    {m.id !== me.user.id && (
                      <button className="btn small danger" onClick={() => { if (confirm(t('remove_confirm', { name: m.display_name }))) act(() => api(`/admin/members/${m.id}`, { method: 'DELETE' })); }}>{t('remove')}</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
      <h3 style={{ marginTop: 22 }}>{t('backup')}</h3>
      <p className="muted small" style={{ marginTop: 0 }}>{t('backup_help')}</p>
      <a className="btn" href="/api/admin/backup" download>{t('backup')}</a>
      {data && (full ? <p className="muted small">{t('family_full')}</p> : (
        <form onSubmit={add} style={{ marginTop: 12 }}>
          <label className="field"><span>{t('add_member')}</span><input value={newName} maxLength={40} placeholder={t('member_name')} onChange={(e) => setNewName(e.target.value)} /></label>
          <button className="btn primary" disabled={!newName.trim()}>{t('create_invite')}</button>
        </form>
      ))}
    </Section>
  );
}

function DataAndAccount() {
  const { me, t, setMe } = useApp();
  const [askDelete, setAskDelete] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  async function signOut() { await api('/auth/logout', { method: 'POST' }).catch(() => {}); setMe(null); }
  async function remove(e) {
    e.preventDefault();
    setError(null);
    try { await api('/me', { method: 'DELETE', body: { pin } }); setMe(null); } catch (err) { setError(err); }
  }
  return (
    <Section title={t('your_data')}>
      <div className="row wrap">
        <a className="btn" href="/api/me/export" download>{t('export')}</a>
        <button className="btn" onClick={signOut}>{t('sign_out')}</button>
        <button className="btn danger" onClick={() => setAskDelete((v) => !v)}>{t('delete_account')}</button>
      </div>
      {askDelete && (
        <form onSubmit={remove} style={{ marginTop: 14 }}>
          <p>{t('delete_confirm')}</p>
          <input type="hidden" autoComplete="username" value={me.user.loginName} readOnly />
          <label className="field"><span>{t('pin')}</span><PinInput value={pin} onChange={setPin} /></label>
          <ErrorMsg error={error} />
          <button className="btn danger" disabled={pin.length < 4}>{t('delete_account')}</button>
        </form>
      )}
    </Section>
  );
}

export default function Settings() {
  const { me, t } = useApp();
  useEffect(() => {
    if (location.hash === '#plan') setTimeout(() => document.getElementById('plan')?.scrollIntoView({ block: 'start' }), 300);
  }, []);
  return (
    <div className="shell">
      <h1>{t('nav_settings')}</h1>
      {me.user.role === 'admin' && <Admin />}
      <Profile />
      <Plan />
      <Display />
      <Security />
      <DataAndAccount />
      <Section title={t('about')}>
        <p style={{ marginTop: 0 }}>{t('disclaimer')}</p>
        <p className="small muted">{t('source_line')} <a href="https://tanzil.net" target="_blank" rel="noopener noreferrer">tanzil.net</a></p>
        <p className="small muted" style={{ marginBottom: 0 }}>{t('coming_soon')}</p>
      </Section>
    </div>
  );
}
