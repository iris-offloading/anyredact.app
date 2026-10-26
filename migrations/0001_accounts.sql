-- Accounts for paid AI detection. Free use needs no account.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  google_sub TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  stripe_customer TEXT,
  -- Subscription: pages per billing period and how many are used.
  sub_id TEXT,
  sub_pages INTEGER NOT NULL DEFAULT 0,
  sub_used INTEGER NOT NULL DEFAULT 0,
  sub_period_end INTEGER NOT NULL DEFAULT 0,
  -- One-off packs: pages that never expire.
  pack_pages INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Stripe events already applied, so retried webhooks don't double-credit.
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
