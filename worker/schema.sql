-- The feedback table. Run this once in the D1 database (Cloudflare dashboard > Storage & Databases > D1 > your database > Console).
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created TEXT NOT NULL,   -- when it arrived (UTC, ISO 8601)
  kind TEXT NOT NULL,      -- broken, idea, look or other
  app TEXT,                -- the streaming app they picked, if any
  message TEXT NOT NULL,
  contact TEXT             -- an email or @name, only if they typed one
);
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
