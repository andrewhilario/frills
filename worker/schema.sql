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
