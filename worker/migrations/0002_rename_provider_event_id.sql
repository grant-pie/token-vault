-- Column was named for Stripe before the project switched payment
-- processors to Paystack (Stripe doesn't support South Africa as a seller
-- country). Renamed for clarity — purely a rename, no data existed yet.
DROP INDEX idx_ledger_stripe_event;
ALTER TABLE ledger RENAME COLUMN stripe_event_id TO provider_event_id;
CREATE UNIQUE INDEX idx_ledger_provider_event ON ledger(provider_event_id) WHERE provider_event_id IS NOT NULL;
