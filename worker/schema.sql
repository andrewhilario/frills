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
