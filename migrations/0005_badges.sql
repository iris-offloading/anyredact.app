-- Footer badge wall: directory badge codes as pasted (src/worker/badges.ts).
CREATE TABLE badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
