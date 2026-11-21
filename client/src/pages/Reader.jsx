import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../state.jsx';
import { arabicDigits } from '../i18n.js';
import { Loading, ErrorState, Bar } from '../components/ui.jsx';
import { CompleteButton } from '../components/complete.jsx';
import { IBookmark, IMinus, IPlus, ISun, IMoon, IPin, IPage, IList, IChevL, IChevR, ICheck } from '../icons.jsx';

let quranCache = null; // the text never changes; fetch once per app load

/** Verse text for display. Verse 2:1 begins with the Basmala in the source; it is shown as a heading instead. */
const verseText = (quran, v) => (v.n === 1 ? v.text.slice(quran.basmala.prefixLength) : v.text);
const marker = (n) => '۝' + arabicDigits(n);

/** Largest font size (px) at which the page text fits its box without scrolling. */
function fitText(el, max) {
  if (!el) return;
  let lo = 10;
  let hi = max;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    el.style.fontSize = `${mid}px`;
    if (el.scrollHeight <= el.clientHeight + 1) lo = mid; else hi = mid;
  }
  el.style.fontSize = `${Math.floor(lo * 10) / 10}px`;
}

export default function Reader() {
  const { me, t, updateMe, showToast, refresh } = useApp();
  const [params] = useSearchParams();
  const askedPart = Number(params.get('part')) || null;
  const [quran, setQuran] = useState(quranCache);
  const [progress, setProgress] = useState(null);
  const [parts, setParts] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [banner, setBanner] = useState(null);
  const [seenMax, setSeenMax] = useState(0);
  const [topVerse, setTopVerse] = useState(null);
  const [showMarks, setShowMarks] = useState(false);
  const [fontScale, setFontScale] = useState(me.user.fontScale || 1);
  const [layout, setLayout] = useState(me.user.readerLayout === 'page' ? 'page' : 'list');
  const [page, setPage] = useState(null);
  const [partBusy, setPartBusy] = useState(false);

  const pending = useRef(null);
  const ready = useRef(false);
  const saveTimer = useRef(null);
  const fontTimer = useRef(null);
  const touch = useRef(null);
  const textRef = useRef(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [q, p, pt] = await Promise.all([quranCache ? Promise.resolve(quranCache) : api('/quran'), api('/progress'), api('/parts/today').catch(() => null)]);
      quranCache = q;
      setQuran(q);
      setParts(pt);
      // Opening a part from Home starts at the beginning of that part.
      const part = askedPart && pt?.parts.find((x) => x.number === askedPart);
      setProgress(part ? { ...p, position: part.from } : p);
    } catch (e) { setError(e); }
  }, [askedPart]);
  useEffect(() => { load(); }, [load]);

  // Pages of the mushaf (a verse belongs to the page it starts on).
  const pages = useMemo(() => {
    if (!quran) return [];
    const m = new Map();
    for (const v of quran.verses) (m.get(v.page) ?? m.set(v.page, []).get(v.page)).push(v);
    return [...m.entries()].map(([number, verses]) => ({ number, verses, juz: verses[0].juz }));
  }, [quran]);
  const pageOfVerse = useCallback((n) => quran?.verses[n - 1]?.page, [quran]);

  // ---- autosave of reading position ----
  const flush = useCallback((keepalive = false) => {
    if (!pending.current) return;
    const body = pending.current;
    pending.current = null;
    api('/progress', { method: 'PUT', body, keepalive }).catch(() => { pending.current = pending.current || body; });
  }, []);
  const queueSave = useCallback((verse, seen) => {
    if (!ready.current) return;
    pending.current = { verse, seen: Math.max(seen, pending.current?.seen ?? 0) };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flush(), 1500);
  }, [flush]);
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true); };
    const onPageHide = () => flush(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => { flush(true); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onPageHide); };
  }, [flush]);

  const loaded = Boolean(quran && progress);

  // ---- verse-by-verse view: observe which verses are on screen ----
  useEffect(() => {
    if (!loaded || layout !== 'list') return;
    const visible = new Set();
    let seen = 0;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const n = Number(e.target.dataset.n);
        if (e.isIntersecting) visible.add(n); else visible.delete(n);
      }
      if (!visible.size) return;
      const top = Math.min(...visible);
      const bottom = Math.max(...visible);
      setTopVerse(top);
      if (ready.current && bottom > seen) { seen = bottom; setSeenMax((s) => Math.max(s, bottom)); }
      queueSave(top, seen || top);
    }, { rootMargin: '-110px 0px -25% 0px' });
    document.querySelectorAll('.ayah').forEach((el) => io.observe(el));

    // Continue from where I stopped.
    const pos = progress.position;
    if (pos > 1) {
      document.getElementById(`v-${pos}`)?.scrollIntoView({ block: 'start' });
      setBanner(pos);
    } else window.scrollTo(0, 0);
    const timer = setTimeout(() => { ready.current = true; }, 900);
    return () => { io.disconnect(); clearTimeout(timer); ready.current = false; };
  }, [loaded, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- full page view ----
  useEffect(() => {
    if (!loaded || layout !== 'page') return;
    setPage((p) => p ?? pageOfVerse(progress.position));
    const timer = setTimeout(() => { ready.current = true; }, 600);
    document.documentElement.classList.add('reading-page');
    return () => { clearTimeout(timer); ready.current = false; document.documentElement.classList.remove('reading-page'); };
  }, [loaded, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = pages.find((p) => p.number === page);
  // Showing a page saves my place at its first verse and counts the page as seen.
  useEffect(() => {
    if (layout !== 'page' || !current) return;
    const first = current.verses[0].n;
    const last = current.verses.at(-1).n;
    const timer = setTimeout(() => {
      ready.current = true;
      queueSave(first, last);
      setSeenMax((s) => Math.max(s, last));
    }, 700);
    return () => clearTimeout(timer);
  }, [layout, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit the whole page on screen: choose the largest text size that needs no scrolling.
  useLayoutEffect(() => {
    if (layout !== 'page' || !current) return;
    let cancelled = false;
    const fit = () => { if (!cancelled) fitText(textRef.current, Math.round(34 * fontScale)); };
    fit();
    document.fonts?.ready.then(fit);
    window.addEventListener('resize', fit);
    return () => { cancelled = true; window.removeEventListener('resize', fit); };
  }, [layout, page, current, fontScale]);

  const firstPage = pages[0]?.number;
  const lastPage = pages.at(-1)?.number;
  const turn = (delta) => {
    setSelected(null);
    setPage((p) => Math.min(lastPage, Math.max(firstPage, p + delta)));
  };

  function switchLayout() {
    const next = layout === 'list' ? 'page' : 'list';
    flush();
    setSelected(null);
    setBanner(null);
    if (next === 'page') setPage(pageOfVerse(topVerse || progress.position));
    if (next === 'list' && current) setProgress((p) => ({ ...p, position: current.verses[0].n })); // keep my place
    setLayout(next);
    updateMe({ readerLayout: next }).catch(() => {});
  }

  // ---- font size ----
  const changeFont = (delta) => {
    const next = Math.round(Math.min(2.2, Math.max(0.8, fontScale + delta)) * 10) / 10;
    setFontScale(next);
    clearTimeout(fontTimer.current);
    fontTimer.current = setTimeout(() => updateMe({ fontScale: next }).catch(() => {}), 600);
  };
  const isDark = me.user.theme === 'dark' || (me.user.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  const bookmarks = useMemo(() => new Set(progress?.bookmarks ?? []), [progress]);
  async function toggleBookmark(n) {
    const has = bookmarks.has(n);
    setProgress((p) => ({ ...p, bookmarks: has ? p.bookmarks.filter((b) => b !== n) : [...p.bookmarks, n].sort((a, b) => a - b) }));
    try { await api(has ? `/bookmarks/${n}` : '/bookmarks', { method: has ? 'DELETE' : 'POST', body: has ? undefined : { verse: n } }); }
    catch (e) { showToast(t.err(e.code)); load(); }
    setSelected(null);
  }
  async function savePlace(n) {
    try {
      await api('/progress', { method: 'PUT', body: { verse: n, seen: n } });
      setProgress((p) => ({ ...p, position: n }));
      showToast(t('place_saved'));
    } catch (e) { showToast(t.err(e.code)); }
    setSelected(null);
  }
  const goTo = (n) => {
    setShowMarks(false);
    setBanner(null);
    if (layout === 'page') { setPage(pageOfVerse(n)); setSelected(n); return; }
    document.getElementById(`v-${n}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  if (error) return <div className="shell"><ErrorState error={error} onRetry={load} /></div>;
  if (!loaded) return <div className="shell"><Loading /></div>;

  // ---- which of my parts am I reading? ----
  const myParts = parts ? parts.parts.filter((p) => parts.mine.includes(p.number)) : [];
  const hereVerse = layout === 'page' ? current?.verses[0].n : topVerse || progress.position;
  const activePart = myParts.find((p) => hereVerse >= p.from && hereVerse <= p.to)
    || myParts.find((p) => p.number === askedPart) || myParts.find((p) => !p.claim.done) || myParts[0];
  const inMyParts = (pageNo) => myParts.some((p) => pageNo >= p.pageFrom && pageNo <= p.pageTo);

  async function togglePart(p) {
    setPartBusy(true);
    try {
      setParts(await api(`/parts/${p.number}/done`, { method: p.claim.done ? 'DELETE' : 'POST' }));
      await refresh();
      if (!p.claim.done) showToast(t('marked_done'));
    } catch (e) { showToast(t.err(e.code)); } finally { setPartBusy(false); }
  }

  const partBar = activePart && (() => {
    const pct = activePart.claim.done ? 100
      : Math.max(0, Math.min(100, Math.round(((Math.min(seenMax, activePart.to) - activePart.from + 1) / (activePart.to - activePart.from + 1)) * 100)));
    const inside = hereVerse >= activePart.from && hereVerse <= activePart.to;
    return { pct, inside, label: t('your_part_line', { n: activePart.number, from: activePart.pageFrom, to: activePart.pageTo }) };
  })();

  const portion = progress.portion;
  const livePct = me.stats.doneToday ? 100 : Math.max(portion.percent, Math.round(((Math.min(seenMax, portion.to) - portion.from + 1) / (portion.to - portion.from + 1)) * 100));

  const partButton = activePart && (
    activePart.claim.done ? (
      <div className="row" style={{ gap: 6 }}>
        <span className="btn done small" role="status"><ICheck />{t('part_read_done')}</span>
        <button className="btn ghost small" disabled={partBusy} onClick={() => togglePart(activePart)}>{t('undo')}</button>
      </div>
    ) : partBar.inside || layout === 'list' ? (
      <button className="btn primary small" disabled={partBusy} onClick={() => togglePart(activePart)}><ICheck />{t('mark_part_n', { n: activePart.number })}</button>
    ) : (
      <button className="btn small" onClick={() => goTo(activePart.from)}>{t('go_to_part', { n: activePart.number })}</button>
    )
  );

  const verseProps = (v) => ({
    'data-n': v.n,
    role: 'button',
    tabIndex: 0,
    'aria-label': t('verse_n', { n: v.n }),
    onClick: () => setSelected(selected === v.n ? null : v.n),
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(v.n); } },
  });

  const tools = (
    <div className="reader-tools">
      <div className="row between">
        <div className="row">
          {layout === 'list' ? (
            <>
              <button className="btn icon" onClick={() => changeFont(-0.1)} aria-label={t('font_smaller')} title={t('font_smaller')}><IMinus /></button>
              <span className="small muted" aria-live="polite" style={{ minWidth: 40, textAlign: 'center' }}>{t.num(Math.round(fontScale * 100))}%</span>
              <button className="btn icon" onClick={() => changeFont(0.1)} aria-label={t('font_larger')} title={t('font_larger')}><IPlus /></button>
            </>
          ) : current && (
            <span className="small muted">{t('page_x_of', { p: current.number })} · {t('juz_n', { j: current.juz })}</span>
          )}
        </div>
        <div className="row">
          <button className={`btn icon ${layout === 'page' ? 'on' : ''}`} onClick={switchLayout} aria-pressed={layout === 'page'}
            aria-label={layout === 'page' ? t('list_view') : t('page_view')} title={layout === 'page' ? t('list_view') : t('page_view')}>
            {layout === 'page' ? <IList /> : <IPage />}
          </button>
          <button className="btn icon" onClick={() => setShowMarks(true)} aria-label={t('bookmarks')} title={t('bookmarks')}><IBookmark /></button>
          <button className="btn icon" onClick={() => updateMe({ theme: isDark ? 'light' : 'dark' })} aria-label={t('theme_toggle')} title={t('theme_toggle')}>{isDark ? <ISun /> : <IMoon />}</button>
        </div>
      </div>
      {banner && layout === 'list' && (
        <div className="row between small" style={{ marginTop: 6 }}>
          <span className="muted">{t('continued_from', { v: banner })}</span>
          <button className="btn ghost small" onClick={() => goTo(portion.from > 1 && portion.from !== banner ? portion.from : 1)}>
            {portion.from > 1 && portion.from !== banner ? t('jump_start') : t('beginning')}
          </button>
        </div>
      )}
    </div>
  );

  const dialogs = (
    <>
      {selected && (
        <div className="verse-actions" role="dialog" aria-label={t('verse_n', { n: selected })}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <b>{t('verse_n', { n: selected })}</b>
            <button className="btn ghost small" onClick={() => setSelected(null)}>{t('close')}</button>
          </div>
          <div className="grid2">
            <button className="btn" onClick={() => toggleBookmark(selected)}><IBookmark filled={bookmarks.has(selected)} />{bookmarks.has(selected) ? t('remove_bookmark') : t('bookmark')}</button>
            <button className="btn" onClick={() => savePlace(selected)}><IPin />{t('set_place')}</button>
          </div>
        </div>
      )}
      {showMarks && (
        <div className="verse-actions" role="dialog" aria-label={t('bookmarks')}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <b>{t('bookmarks')}</b>
            <button className="btn ghost small" onClick={() => setShowMarks(false)}>{t('close')}</button>
          </div>
          {progress.bookmarks.length === 0 ? <p className="muted small">{t('no_bookmarks')}</p> : (
            <div className="row wrap" style={{ gap: 8 }}>
              {progress.bookmarks.map((b) => <button key={b} className="btn small" onClick={() => goTo(b)}>{t('verse_n', { n: b })}</button>)}
            </div>
          )}
          <form className="row" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); const n = Number(new FormData(e.target).get('v')); if (n >= 1 && n <= 286) goTo(n); }}>
            <input name="v" type="number" min="1" max="286" inputMode="numeric" placeholder={t('go_to_verse')} aria-label={t('go_to_verse')} />
            <button className="btn">{t('go')}</button>
          </form>
        </div>
      )}
    </>
  );

  // ================= full page view: the whole page on one screen =================
  if (layout === 'page') {
    return (
      <div className="page-screen">
        {tools}
        {current && (
          <article
            className={`mushaf-page ${inMyParts(current.number) ? 'mine' : ''}`}
            aria-label={t('page_n', { p: current.number })}
            onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
            onTouchEnd={(e) => {
              if (!touch.current) return;
              const dx = e.changedTouches[0].clientX - touch.current.x;
              const dy = e.changedTouches[0].clientY - touch.current.y;
              touch.current = null;
              // Like an Arabic book: swipe towards the right for the next page.
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) turn(dx > 0 ? 1 : -1);
            }}
          >
            <div className="mushaf-head">
              <span>{t('juz_n', { j: current.juz })}</span>
              {inMyParts(current.number) && <span className="pill done">{t('yours')}</span>}
              <span lang="ar">سُورَةُ البَقَرَةِ</span>
            </div>
            <div className="mushaf-text" ref={textRef} lang="ar" dir="rtl">
              {current.verses[0].n === 1 && (
                <div className="mushaf-opening">
                  <div className="surah-frame"><div className="ar-title">سُورَةُ البَقَرَةِ</div></div>
                  <div className="basmala">{quran.basmala.text}</div>
                </div>
              )}
              {current.verses.map((v) => (
                <span key={v.n} id={`v-${v.n}`} {...verseProps(v)}
                  className={`ayah-inline ${selected === v.n ? 'selected' : ''} ${progress.position === v.n ? 'place' : ''} ${bookmarks.has(v.n) ? 'marked' : ''}`}>
                  <span className="text">{verseText(quran, v)}</span>{' '}
                  <span className="num" aria-hidden="true">{marker(v.n)}</span>{' '}
                </span>
              ))}
            </div>
            <div className="mushaf-foot" aria-hidden="true">{arabicDigits(current.number)}</div>
          </article>
        )}
        <div className="page-bottom">
          <button className="btn icon" onClick={() => turn(1)} disabled={current?.number >= lastPage} aria-label={t('next_page')} title={t('next_page')}><IChevL /></button>
          <div className="page-bottom-mid">
            {partButton || <CompleteButton block={false} onChange={() => api('/progress').then(setProgress).catch(() => {})} />}
          </div>
          <button className="btn icon" onClick={() => turn(-1)} disabled={current?.number <= firstPage} aria-label={t('prev_page')} title={t('prev_page')}><IChevR /></button>
        </div>
        {dialogs}
      </div>
    );
  }

  // ================= verse-by-verse view =================
  let lastPageSeen = null;
  return (
    <div className="shell reader-shell" style={{ '--quran-size': `${Math.round(30 * fontScale)}px` }}>
      {tools}
      <header className="surah-head">
        <div className="surah-frame">
          <div className="ar-title" lang="ar" dir="rtl">سُورَةُ البَقَرَةِ</div>
          <div className="muted small">{t('surah_title')} · {t('surah_sub')}</div>
        </div>
        <div className="basmala" lang="ar" dir="rtl">{quran.basmala.text}</div>
      </header>

      <div className="quran" lang="ar" dir="rtl">
        {quran.verses.map((v) => {
          const showPage = v.page !== lastPageSeen && lastPageSeen !== null;
          lastPageSeen = v.page;
          return (
            <div key={v.n}>
              {showPage && <div className="page-break">{t('page_n', { p: v.page })} · {t('juz_n', { j: v.juz })}{inMyParts(v.page) ? ` · ${t('yours')}` : ''}</div>}
              <p id={`v-${v.n}`} {...verseProps(v)}
                className={`ayah ${selected === v.n ? 'selected' : ''} ${progress.position === v.n ? 'place' : ''}`}>
                {bookmarks.has(v.n) && <span className="bm" aria-label={t('bookmark')}><IBookmark filled /></span>}
                <span className="text">{verseText(quran, v)}</span>{' '}
                <span className="num" aria-hidden="true">{marker(v.n)}</span>
              </p>
            </div>
          );
        })}
      </div>

      <p className="attribution">
        {t('autosave_note')} {t('source_line')}{' '}
        <a href={quran.source.textUrl} target="_blank" rel="noopener noreferrer">tanzil.net</a>
      </p>
      <p className="footer-note">{t('disclaimer')}</p>
      {dialogs}

      <div className="complete-bar">
        <div className="inner">
          {partBar ? (
            <>
              <div className="row between small muted"><span>{partBar.label}</span><span>{t.num(partBar.pct)}%</span></div>
              <Bar value={partBar.pct} label={partBar.label} />
              <div className="row">{partButton}</div>
            </>
          ) : (
            <>
              <div className="row between small muted"><span>{portion.to - portion.from < 285 ? t('verses_range', portion) : t('portion_progress')}</span><span>{t.num(livePct)}%</span></div>
              <Bar value={livePct} label={t('portion_progress')} />
              <CompleteButton onChange={() => api('/progress').then(setProgress).catch(() => {})} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
