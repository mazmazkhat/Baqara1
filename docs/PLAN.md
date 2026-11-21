# Baqarah Together — Plan & Architecture

A private, mobile-first web app that helps one family of six read Surah Al-Baqarah every day, together and without competition.

## Decisions (from the kick-off questions)

| Question | Decision |
|---|---|
| Hosting | **Free**: Render free web service + Turso free database (SQLite-compatible). Free web hosts don't keep files, so data lives in Turso. Still portable: a local SQLite file or Docker also works. See [DEPLOY-FREE.md](DEPLOY-FREE.md). |
| Sign-in | **Invite link + 4–6 digit PIN** (administrator: 6 digits). |
| Interface language | **English and Arabic**, chosen per person; Arabic uses a full right-to-left layout. |
| Reminders | **Web push** (installable app). Planned for phase 2; the database tables already exist. |

## 1. Architecture

```
 Phone / tablet / desktop browser  (installable PWA)
   React 19 single-page app  ── fonts self-hosted (Amiri Quran, Noto Naskh Arabic)
        │  same-origin HTTPS, httpOnly session cookie, X-Requested-With header
        ▼
 Node.js 20+ + Express  (server/app.js)  — on Render's free plan
   • auth: scrypt PIN hashes, hashed session tokens, lockout, CSRF guard, strict CSP (helmet)
   • every query scoped to the signed-in member's family_id
   • time-zone aware "today" per member (Intl API, IANA zones)
        │
        ▼
 Turso (hosted SQLite, free plan) via @libsql/client — or a local SQLite file for development/self-hosting
 data/al-baqarah.json       — verified Quran text, served read-only to signed-in members
```

* **No runtime third-party calls.** The Quran text is stored in the repository (verified, with checksum) so the app keeps working if an external API is down, and nothing about the family leaks to outside services.
* **Only secret:** the Turso database URL and token, stored in Render's environment settings (never in the code or the browser). Phase-2 web push needs a VAPID key pair, generated once and kept in server environment variables only.

## 2. Main user flows

1. **First-time setup (administrator):** deploy → the server prints a one-time *setup code* in its log → open `/setup`, enter the code, family name, your name, login name and a 6-digit PIN. Without that code no one can claim a fresh server.
2. **Inviting the family:** Settings → *Family administration* → *Add a family member* → type their name → *Create invite link* → share with the phone's share sheet (WhatsApp, SMS…). The link works once and expires in 7 days. The family is capped at six members.
3. **Joining:** the member opens the link → sees "Assalamu alaikum, Maryam" → chooses a login name and PIN → signed straight in. Their time zone is detected from the phone.
4. **Daily reading (default):** Home → *Continue from verse N* → the reader opens at their saved place → scrolling autosaves the position → *Mark today complete*. Mistakes can be undone the same day.
5. **Family view:** see who has read today (✓ or "Not yet", never red), each person's progress for today, the week and the last 30 days as family totals, and gentle encouragement.
6. **Forgotten PIN:** the administrator taps *New link (reset PIN)* next to the member; the old sessions are signed out and the member sets a new PIN from the link.
7. **Leaving:** any member can download their data (JSON) or delete their account (PIN confirmation). The administrator can remove members.

## 3. Database schema

Full DDL: [`server/schema.sql`](../server/schema.sql). `*_date` columns are local calendar days in the person's time zone; `*_at` columns are UTC timestamps.

| Table | Purpose | Key columns |
|---|---|---|
| `families` | Private family group | name, timezone (for family history), max_members = 6 |
| `users` | A person | display_name, login_name (unique), pin_hash (scrypt), avatar, avatar_color, locale, timezone, theme, font_scale, failed_logins, locked_until |
| `family_memberships` | User ↔ family, access level | role `admin`/`member`, status `invited`/`active`, sort_order (fixed display order) |
| `invitations` | Join / reset-PIN links | token_hash (sha-256, token never stored), purpose, expires_at, used_at |
| `sessions` | Signed-in devices | token_hash, expires_at (180 days), last_seen_at |
| `reading_plans` | Preferred pace / family part | plan_type `free`/`whole`/`verses`/`days`/`pages`, verses_per_day, days_total, page_from, page_to (one of the six fixed parts) |
| `reading_progress` | Where each person is | current_verse, cycle_start_verse, furthest_verse, cycles_completed, total_verses_read |
| `daily_completions` | "I read today" | local_date (unique per user), from_verse, to_verse, prev_state (for undo) |
| `part_claims` | Who took which part today | family_id, local_date (family day), part 1–6 (unique per family/day), user_id, done_at |
| `bookmarks` | Saved verses | verse (unique per user) |
| `reflections` *(phase 2)* | Notes | body, verse_from/to, local_date, visibility `private`/`family` |
| `reminders` *(phase 2)* | Daily reminders | user_id (NULL = family default), time_local, timezone, message, quiet_days, missed_followup |
| `push_subscriptions` *(phase 2)* | Web push endpoints | endpoint, keys_json |
| `family_goals` *(phase 2)* | Shared goals | goal_type, title, target, start/end date |

## 4. Quran text & audio sources

* **Arabic text — Tanzil Project, Uthmani text v1.1** (<https://tanzil.net>), licensed CC BY 3.0 with the condition that the text is copied *verbatim*. Stored in `data/al-baqarah.json` exactly as downloaded, with the full Tanzil copyright notice and a SHA-256 checksum.
  * `npm run fetch:quran` re-downloads it and **cross-checks every one of the 286 verses** against Quran.com's independent Uthmani text (letter skeleton comparison); it aborts on any mismatch.
  * `npm run verify:quran` re-checks the checksum offline.
  * Tanzil places the Basmala at the start of verse 2:1. The reader shows it as a heading, using exactly the same characters (nothing is retyped).
  * The verse-end ornament (۝ + Arabic-Indic digits) is drawn by the Amiri Quran font.
* **Mushaf page & juz numbers** — Quran.com API v4 (Madani 604-page layout), stored alongside the text.
* **Typography** — Amiri Quran (SIL Open Font License), self-hosted.
* **Audio (phase 2)** — verse-by-verse recitation streamed directly from EveryAyah.com / Quran.com's audio CDN (e.g. Mishary Alafasy), no key required. The content security policy already allows these two hosts for audio only.
* **Translations (phase 2)** — candidates: Saheeh International (English) and *Al-Muyassar* (Arabic tafsir). Translation copyrights vary, so each needs a licence check before it is stored. Any translation will always be labelled *"Translation — not the Quran itself"*.

## 5. Third-party services

| Needed now | Purpose |
|---|---|
| Render (free web service) | runs the app, HTTPS address; sleeps after 15 idle minutes (wakes in up to ~1 min) |
| Turso (free database) | stores the family's data; needs a URL + token kept only in Render's environment settings |

| Optional / later | Purpose |
|---|---|
| Browser push services (built into Chrome, Safari, Firefox) | reminders; free, no account; iPhone needs iOS 16.4+ and the app added to the Home Screen |
| EveryAyah.com / Quran.com CDN | streaming audio recitation |

No advertising, analytics or tracking scripts are used.

## 6. Security & privacy summary

* PINs hashed with scrypt (per-user salt). Session and invite tokens are random 256-bit values and only their SHA-256 is stored.
* 5 wrong PINs → 15-minute pause (doubling, max 24 h), plus a per-device limit. Errors never reveal whether a login name exists.
* Cookies: `HttpOnly`, `SameSite=Lax`, `Secure` in production. State-changing requests require a custom header (CSRF).
* Strict Content-Security-Policy, no inline scripts, `frame-ancestors 'none'`, `noindex`.
* Authorization: every family query uses the signed-in member's `family_id`; admin endpoints check role *and* that the target belongs to the same family (tested).
* Data export (JSON) and self-service account deletion (cascading).

## 7. Roadmap

* **Phase 1 (this version):** authentication & invitations, six-member family, verified Quran reader (text size, light/dark, bookmarks, autosave, continue), reading plans, **daily family parts (6-6-9-9-9-9 pages, taken on Home each day, visible to all) with the whole Surah as the family's daily goal**, **full mushaf page view that fits the screen**, daily completion with undo, streaks, gentle missed-day wording, family dashboard with weekly/monthly history, English/Arabic, export & delete.
* **Phase 2:** web-push reminders (family default + personal override, quiet days, one gentle follow-up at most), verse audio, translations, reflections (private / shared with family), family goals.
* **Phase 3:** optional profile photos, offline reading of the cached text, backups helper.
