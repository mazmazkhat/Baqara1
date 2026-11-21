import { ICheck } from '../icons.jsx';
import { useApp } from '../state.jsx';

export function Avatar({ person, size = '', done = false, faded = false }) {
  const initials = (person.displayName || '?').trim().split(/\s+/).map((w) => [...w][0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className={`avatar ${size} c-${person.avatarColor || 'green'} ${faded ? 'faded' : ''}`} aria-hidden="true">
      {person.avatar ? <span className="emoji">{person.avatar}</span> : initials}
      {done && <span className="check"><ICheck /></span>}
    </span>
  );
}

export function Bar({ value, gold, label }) {
  return (
    <div className={`bar ${gold ? 'gold' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Loading() {
  const { t } = useApp();
  return <div className="center-state" role="status"><div className="spinner" />{t('loading')}</div>;
}

export function ErrorState({ error, onRetry }) {
  const { t } = useApp();
  return (
    <div className="center-state" role="alert">
      <p>{t.err(error?.code)}</p>
      {onRetry && <button className="btn" onClick={onRetry}>{t('retry')}</button>}
    </div>
  );
}

export function ErrorMsg({ error }) {
  const { t } = useApp();
  if (!error) return null;
  return <div className="alert error" role="alert">{t.err(error.code)}</div>;
}

export function PinInput({ value, onChange, id, autoComplete = 'current-password', label }) {
  return (
    <input
      id={id} className="pin" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete={autoComplete}
      value={value} aria-label={label} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
    />
  );
}
