-- Recent activity on the account page: what each scan or payment cost, by format
-- and size. No file names or content. One row per opened file (its job ID) or Stripe event.
CREATE TABLE activity (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job TEXT NOT NULL,
  -- A format (pdf, docx, pptx, sheet, text, image, audio), check, credits, plan, refund or dispute.
  kind TEXT NOT NULL,
  -- Signed: spent credits are negative.
  credits INTEGER NOT NULL,
  -- What a payment or refund came to, in cents.
  cents INTEGER,
  at INTEGER NOT NULL,
  PRIMARY KEY (user_id, job)
);
CREATE INDEX activity_user_at ON activity (user_id, at);
