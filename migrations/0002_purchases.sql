-- One-off pack purchases, so a refund or dispute can take their credits back.
CREATE TABLE purchases (
  payment_intent TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pages INTEGER NOT NULL,
  -- Credits already taken back by refunds or disputes.
  taken INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
