-- Packs and pages are now credits, and the subscription is the plan.
ALTER TABLE users RENAME COLUMN sub_id TO plan_subscription;
ALTER TABLE users RENAME COLUMN sub_pages TO plan_credits;
ALTER TABLE users RENAME COLUMN sub_used TO plan_used;
ALTER TABLE users RENAME COLUMN sub_period_end TO plan_period_end;
ALTER TABLE users RENAME COLUMN pack_pages TO credits;
ALTER TABLE purchases RENAME COLUMN pages TO credits;
