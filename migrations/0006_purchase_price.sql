-- A pack's price before tax, so a refund of part of it takes back the matching share of credits,
-- and the credits an open dispute took, so they come back when it closes in our favour.
ALTER TABLE purchases ADD COLUMN cents INTEGER;
ALTER TABLE purchases ADD COLUMN disputed INTEGER NOT NULL DEFAULT 0;
