-- Baqara Family schema (SQLite). Dates named *_date are local calendar dates (YYYY-MM-DD)
-- in the relevant person's time zone; *_at columns are UTC ISO-8601 timestamps.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS families (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'UTC',      -- used for family-level daily summaries
  max_members   INTEGER NOT NULL DEFAULT 6,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  display_name    TEXT NOT NULL,
  login_name      TEXT UNIQUE,                    -- chosen when the invite is accepted
  pin_hash        TEXT,                           -- scrypt; NULL until the invite is accepted
  avatar          TEXT NOT NULL DEFAULT '',        -- emoji, or empty for initials
  avatar_color    TEXT NOT NULL DEFAULT 'green',
  locale          TEXT NOT NULL DEFAULT 'en',      -- 'en' | 'ar'
  timezone        TEXT NOT NULL DEFAULT 'UTC',
  theme           TEXT NOT NULL DEFAULT 'system',  -- 'system' | 'light' | 'dark'
  font_scale      REAL NOT NULL DEFAULT 1.0,
  reader_layout   TEXT NOT NULL DEFAULT 'list',    -- 'list' (verse by verse) | 'page' (full mushaf page)
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS family_memberships (
  id          INTEGER PRIMARY KEY,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, -- one family per person
  role        TEXT NOT NULL CHECK (role IN ('admin','member')),
  status      TEXT NOT NULL CHECK (status IN ('invited','active')),
  sort_order  INTEGER NOT NULL DEFAULT 0,          -- fixed display order (never by score)
  joined_at   TEXT
);

CREATE TABLE IF NOT EXISTS invitations (
  id           INTEGER PRIMARY KEY,
  family_id    INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,               -- sha256 of the link token; the token itself is never stored
  purpose      TEXT NOT NULL CHECK (purpose IN ('join','reset')),
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  used_at      TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,                   -- sha256 of the cookie value
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_plans (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_type       TEXT NOT NULL DEFAULT 'free' CHECK (plan_type IN ('free','whole','verses','days','pages')),
  verses_per_day  INTEGER,                         -- for 'verses'
  days_total      INTEGER,                         -- for 'days' (finish the Surah over N days)
  page_from       INTEGER,                         -- for 'pages': my part of the family's daily reading
  page_to         INTEGER,                         --   (mushaf pages 2-49; a page belongs to one member)
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reading_progress (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_verse      INTEGER NOT NULL DEFAULT 1,   -- "continue from where I stopped"
  cycle_start_verse  INTEGER NOT NULL DEFAULT 1,   -- where the current portion began
  furthest_verse     INTEGER NOT NULL DEFAULT 0,   -- furthest verse reached in the current cycle
  cycles_completed   INTEGER NOT NULL DEFAULT 0,   -- full readings of the Surah
  total_verses_read  INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_completions (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id     INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  local_date    TEXT NOT NULL,                     -- the member's own calendar day
  from_verse    INTEGER NOT NULL,
  to_verse      INTEGER NOT NULL,
  completed_at  TEXT NOT NULL,
  prev_state    TEXT,                              -- progress snapshot so "undo" can restore it
  UNIQUE (user_id, local_date)
);
CREATE INDEX IF NOT EXISTS idx_completions_family_date ON daily_completions(family_id, local_date);

CREATE TABLE IF NOT EXISTS bookmarks (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verse       INTEGER NOT NULL CHECK (verse BETWEEN 1 AND 286),
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, verse)
);

-- Daily family parts: each day the Surah's six parts (6-6-9-9-9-9 pages) are free again.
-- A member takes a part for the family's day; everyone sees it as taken. Goal: the whole Surah daily.
CREATE TABLE IF NOT EXISTS part_claims (
  id          INTEGER PRIMARY KEY,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  local_date  TEXT NOT NULL,                       -- the family's calendar day (family time zone)
  part        INTEGER NOT NULL CHECK (part BETWEEN 1 AND 6),
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claimed_at  TEXT NOT NULL,
  done_at     TEXT,
  UNIQUE (family_id, local_date, part)
);
CREATE INDEX IF NOT EXISTS idx_part_claims_user ON part_claims(user_id, local_date);

-- Notifications (web push). Gentle by design: at most a daily reminder, one optional follow-up,
-- and one celebration when the family completes the Surah.
CREATE TABLE IF NOT EXISTS app_settings (
  key    TEXT PRIMARY KEY,                         -- e.g. vapid_public, vapid_private, cron_key
  value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS family_reminders (
  family_id      INTEGER PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  enabled        INTEGER NOT NULL DEFAULT 1,
  time_local     TEXT NOT NULL DEFAULT '19:00',      -- each member's own time zone
  message        TEXT NOT NULL DEFAULT '',            -- '' = the standard gentle message
  quiet_days     TEXT NOT NULL DEFAULT '',            -- e.g. '5' (0 = Sunday ... 6 = Saturday)
  followup_time  TEXT NOT NULL DEFAULT '21:30',
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS member_reminders (
  user_id           INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled           INTEGER NOT NULL DEFAULT 1,
  use_family_time   INTEGER NOT NULL DEFAULT 1,
  time_local        TEXT,                           -- own time when use_family_time = 0
  quiet_days        TEXT,                           -- NULL = the family's quiet days
  followup_enabled  INTEGER NOT NULL DEFAULT 0,     -- gentle evening reminder if today's part is not read
  followup_time     TEXT,                           -- NULL = the family's follow-up time
  celebrate         INTEGER NOT NULL DEFAULT 1,     -- tell me when the family completes the Surah
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_log (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                        -- 'daily' | 'followup' | 'whole'
  local_date  TEXT NOT NULL,
  sent_at     TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, local_date)
);

-- Phase 2 tables (schema ready; UI/API arrive in later versions) ------------------------

CREATE TABLE IF NOT EXISTS reflections (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  local_date  TEXT NOT NULL,
  verse_from  INTEGER,
  verse_to    INTEGER,
  body        TEXT NOT NULL,
  visibility  TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','family')),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id               INTEGER PRIMARY KEY,
  family_id        INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE, -- NULL = family default set by admin
  enabled          INTEGER NOT NULL DEFAULT 1,
  time_local       TEXT NOT NULL DEFAULT '20:00',
  timezone         TEXT NOT NULL,
  message          TEXT NOT NULL DEFAULT 'It is time for today''s family Quran reading.',
  quiet_days       TEXT NOT NULL DEFAULT '',      -- e.g. '5,6' (0 = Sunday)
  missed_followup  INTEGER NOT NULL DEFAULT 0,
  last_sent_date   TEXT
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  keys_json   TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS family_goals (
  id          INTEGER PRIMARY KEY,
  family_id   INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  goal_type   TEXT NOT NULL CHECK (goal_type IN ('complete_together','consecutive_days','everyone_today')),
  title       TEXT NOT NULL,
  target      INTEGER,
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
