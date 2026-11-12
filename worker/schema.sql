-- The feedback table. Run this once in the D1 database (Cloudflare dashboard > Storage & Databases > D1 > your database > Console).
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,   -- when it arrived (UTC, ISO 8601)
  kind TEXT NOT NULL,      -- broken, idea, look or other
  app TEXT,                -- the streaming app they picked, if any
  message TEXT NOT NULL,
  contact TEXT,            -- an email or @name, only if they typed one
  status TEXT NOT NULL DEFAULT 'new' -- new or done, set from the admin page
);
-- A database made before the admin page has no status column. Run this one line once to add it (the admin page works without it, but
-- then cannot mark feedback as done):
--   ALTER TABLE feedback ADD COLUMN status TEXT NOT NULL DEFAULT 'new';
CREATE INDEX IF NOT EXISTS feedback_created ON feedback (created);

-- To read the newest 50:  SELECT id, created, kind, app, message, contact FROM feedback ORDER BY id DESC LIMIT 50;
-- To delete one:          DELETE FROM feedback WHERE id = 12;

-- Uploaded images, GIFs and sounds for alerts (see worker/media.mjs). Run this part again whenever it is new.
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,     -- 16 random characters, in the alert link
  kind TEXT NOT NULL,      -- image or sound
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,   -- bytes
  data TEXT NOT NULL,      -- the file, as base64
  created TEXT NOT NULL,   -- UTC, ISO 8601
  delete_hash TEXT NOT NULL -- sha-256 of the delete code (the code itself is never stored)
);
CREATE INDEX IF NOT EXISTS media_created ON media (created);

-- To see what is stored (without the files):  SELECT id, kind, mime, size, created FROM media ORDER BY created DESC LIMIT 50;
-- To remove one that was reported:             DELETE FROM media WHERE id = 'THE_ID';

-- What is playing on a streamer's Spotify, passed from their browser tab to their overlay (see worker/nowplaying.mjs). Run this part once.
CREATE TABLE IF NOT EXISTS nowplaying (
  code TEXT PRIMARY KEY,    -- 16 random characters, in the overlay link
  key_hash TEXT NOT NULL,   -- sha-256 of the key that may change it (the key itself is never stored)
  data TEXT NOT NULL,       -- the song: title, artist, cover, position (JSON)
  updated_at INTEGER NOT NULL -- milliseconds since 1970
);

-- Wrong admin passwords, kept for 10 minutes so that guessing is stopped (see worker/admin.mjs). Run this part once.
CREATE TABLE IF NOT EXISTS admin_tries (
  at INTEGER NOT NULL      -- milliseconds since 1970
);

-- Twitch follows, handed from the streamer's browser tab to their alerts overlay (see worker/follows.mjs). Run this part once.
CREATE TABLE IF NOT EXISTS twitch_boxes (
  code TEXT PRIMARY KEY,     -- 16 random characters, in the overlay link
  key_hash TEXT NOT NULL,    -- sha-256 of the key that may add to it (the key itself is never stored)
  seq INTEGER NOT NULL,      -- the number of the latest follow
  updated_at INTEGER NOT NULL -- milliseconds since 1970; also moved by the tab's "still here" posts
);
CREATE TABLE IF NOT EXISTS twitch_follows (
  code TEXT NOT NULL,
  seq INTEGER NOT NULL,      -- 1, 2, 3 ... for each box
  ev TEXT NOT NULL,          -- Twitch's own id for this follow, so one is never added twice
  login TEXT NOT NULL,       -- the follower's short Twitch name
  name TEXT NOT NULL,        -- the name shown
  at INTEGER NOT NULL,
  PRIMARY KEY (code, seq)
);

-- The Spotify login Frills keeps for a streamer, so the Spotify player works with the Frills page closed (see worker/spotify.mjs). Run this part once.
-- The login itself (secret) is encrypted with a key that is NOT in the database (the SPOTIFY_TOKEN_KEY secret of the Worker); without that key the
-- rows are unreadable. A row is deleted when the streamer presses Disconnect, and by the daily clean-up after 14 days without use.
CREATE TABLE IF NOT EXISTS spotify_logins (
  code TEXT PRIMARY KEY,        -- the same 16 random characters as in nowplaying, in the overlay link
  key_hash TEXT NOT NULL,       -- sha-256 of the key that may change it (the key itself is never stored)
  secret TEXT NOT NULL,         -- the login (refresh token, access token, expiry), encrypted with AES-GCM: iv + ciphertext, base64
  state TEXT NOT NULL DEFAULT 'ok', -- ok, or expired when Spotify no longer accepts the login
  name TEXT NOT NULL DEFAULT '',    -- the Spotify account's display name, for "Connected as ..."
  share INTEGER NOT NULL DEFAULT 1, -- 1: the song playing is shown on the stream
  queue INTEGER NOT NULL DEFAULT 0, -- 1: songs viewers ask for (!sr) are added to the streamer's Spotify queue
  recent TEXT NOT NULL DEFAULT '[]', -- songs added lately, so one is not added twice in a row: [[uri, at], ...] (JSON)
  log TEXT NOT NULL DEFAULT '[]',    -- what happened lately, newest first, for the streamer to read: [{ at, state, text }, ...] (JSON)
  last_act INTEGER NOT NULL DEFAULT 0,   -- when a song was last added or skipped (ms since 1970)
  hour_start INTEGER NOT NULL DEFAULT 0, -- the hour the count below is for
  hour_count INTEGER NOT NULL DEFAULT 0, -- adds and skips in that hour, so a leaked overlay link cannot flood the queue
  hold_until INTEGER NOT NULL DEFAULT 0, -- Spotify asked us to slow down: no questions to Spotify before this time
  created_at INTEGER NOT NULL,
  used_at INTEGER NOT NULL      -- last time the login was used; the clean-up deletes rows idle for 14 days
);

-- The subathon timer's controls, handed from the streamer's browser tab to their timer overlay (see worker/timer.mjs). Run this part once.
CREATE TABLE IF NOT EXISTS timer_boxes (
  code TEXT PRIMARY KEY,     -- 16 random characters, in the overlay link
  key_hash TEXT NOT NULL,    -- sha-256 of the key that may send commands (the key itself is never stored)
  seq INTEGER NOT NULL,      -- the number of the latest command
  updated_at INTEGER NOT NULL -- milliseconds since 1970
);
CREATE TABLE IF NOT EXISTS timer_commands (
  code TEXT NOT NULL,
  seq INTEGER NOT NULL,      -- 1, 2, 3 ... for each box
  cmd TEXT NOT NULL,         -- start, pause, resume, reset or add
  value INTEGER NOT NULL,    -- seconds (for reset and add)
  at INTEGER NOT NULL,
  PRIMARY KEY (code, seq)
);

-- Frills Pro passes for metered AI features (AI Talking Pet TTS) and regional availability gating (see worker/region.mjs, worker/tts.mjs).
CREATE TABLE IF NOT EXISTS pro_passes (
  code TEXT PRIMARY KEY,           -- random 16-char pass id
  pass_hash TEXT NOT NULL,         -- sha-256 of the pass token (the token itself is never stored)
  status TEXT NOT NULL DEFAULT 'active', -- active, paused, canceled
  country TEXT NOT NULL DEFAULT 'US',    -- billing/checkout country (2-letter ISO)
  allow_roam INTEGER NOT NULL DEFAULT 0, -- 1 lets owner or traveling buyer run Pro APIs from any country
  tts_used INTEGER NOT NULL DEFAULT 0,
  tts_limit INTEGER NOT NULL DEFAULT 1500,
  period_start INTEGER NOT NULL,   -- start of current 30-day quota window (ms since 1970)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pro_passes_hash ON pro_passes (pass_hash);

-- Maps external payment provider order/subscription/license ids (e.g. Lemon Squeezy) to pro_passes.code.
CREATE TABLE IF NOT EXISTS pro_links (
  ref_id TEXT PRIMARY KEY,
  pass_code TEXT NOT NULL,
  updated_at INTEGER NOT NULL      -- the time of the latest payment notice that changed this row (the provider's clock), so an older notice arriving late is ignored
);

-- Frills Plus accounts (see worker/accounts.mjs and PLAN-FRILLS-PLUS.md): an email address, nothing else about the person. No passwords: a person signs in with a link sent to their inbox. Run this part once.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,             -- 16 random hex characters; it goes only into the person's own checkout address, so the payment can be matched to the account
  email TEXT NOT NULL UNIQUE,      -- lower case; needed to send the sign-in link
  created_at INTEGER NOT NULL,     -- milliseconds since 1970
  last_login_at INTEGER NOT NULL
);
-- A sign-in link waiting to be used: only the token's hash is kept, it works once, and for 15 minutes.
CREATE TABLE IF NOT EXISTS login_links (
  token_hash TEXT PRIMARY KEY,     -- sha-256 of the token in the emailed link
  email TEXT NOT NULL,
  ip_hash TEXT NOT NULL,           -- sha-256 of the internet address that asked, to slow down abuse; swept after a day
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER                  -- null until it is used
);
CREATE INDEX IF NOT EXISTS login_links_email ON login_links (email, created_at);
CREATE INDEX IF NOT EXISTS login_links_ip ON login_links (ip_hash, created_at);
-- A signed-in browser: only the hash of the cookie value is kept.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);
-- What an account has bought (filled in by the payment webhook, later): one row per account.
CREATE TABLE IF NOT EXISTS plus (
  account_id TEXT PRIMARY KEY,
  provider_ref TEXT NOT NULL DEFAULT '', -- the payment provider's subscription id
  order_ref TEXT NOT NULL DEFAULT '',    -- the payment provider's order id (a refund names the order)
  status TEXT NOT NULL DEFAULT 'active',  -- active, canceled (paid until renews_at), paused, unpaid, expired, refunded
  renews_at INTEGER,               -- paid until (milliseconds): the end of the current month, or the end date of a cancelled one; null if unknown
  tts_used INTEGER NOT NULL DEFAULT 0,
  tts_limit INTEGER NOT NULL DEFAULT 1500,
  period_start INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The link a streamer puts in their streaming app for a Frills Plus overlay (the talking pet): a random code in the link stands for the account, so the payment itself never appears in a link. Only the code's hash is kept. One live link per account and kind; making a new one ends the old. Run this part once.
CREATE TABLE IF NOT EXISTS overlay_links (
  code_hash TEXT PRIMARY KEY,      -- sha-256 of the code in the overlay link
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- 'tts' (the talking pet)
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS overlay_links_account ON overlay_links (account_id, kind);
