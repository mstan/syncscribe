-- sql/bootstrap.sql
-- SyncScribe database schema
-- Run via Postgres.bootstrap() on application startup

-- Users (Google OAuth - no password)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  picture TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Credit packs (predefined purchase options)
CREATE TABLE IF NOT EXISTS credit_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  minutes_amount INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  stripe_price_id TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Seed default packs (fresh installs only; existing rows are left alone, so
-- price changes on a live database are an explicit UPDATE). Keep in sync with
-- client/src/content/marketing.js.
INSERT INTO credit_packs (id, name, minutes_amount, price_cents, active) VALUES
  ('single', 'Single', 120, 999, true),
  ('season', 'Season', 400, 2499, true),
  ('studio', 'Studio', 1500, 7499, true)
ON CONFLICT (id) DO NOTHING;

-- Purchases (Stripe payments)
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_checkout_session_id TEXT UNIQUE,
  provider_payment_intent_id TEXT,
  pack_id TEXT REFERENCES credit_packs(id),
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Credit ledger (ledger-based, never a single balance column)
CREATE TABLE IF NOT EXISTS credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('purchase', 'job_debit', 'refund', 'promo', 'adjustment')),
  minutes_delta INTEGER NOT NULL,
  job_id UUID,
  purchase_id UUID REFERENCES purchases(id),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent double-debit for a job
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_job_debit
  ON credit_ledger (job_id) WHERE type = 'job_debit';

-- Prevent double clawback of a refunded/disputed purchase
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_ledger_purchase_reversal
  ON credit_ledger (purchase_id) WHERE type = 'adjustment' AND purchase_id IS NOT NULL;

-- Jobs
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'awaiting_upload'
    CHECK (status IN ('awaiting_upload', 'queued', 'running', 'succeeded', 'failed', 'cancelled')),
  audio_sha256 TEXT,
  audio_object_key TEXT,
  audio_seconds INTEGER,
  minutes_charged INTEGER,
  cached_hit BOOLEAN DEFAULT FALSE,
  language TEXT,
  additional_languages TEXT[],
  series_context TEXT,
  mode TEXT NOT NULL DEFAULT 'transcribe',
  model TEXT DEFAULT 'whisper-1',
  stage TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

-- Fine-grained progress within the 'running' status (transcribing, translating, …).
-- Added after initial release; idempotent for existing deployments.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS stage TEXT;

-- Credits reserved for an in-flight job (estimate at creation, then the
-- server-measured duration once audio is uploaded). Balance checks subtract
-- the reservations of a user's active jobs so concurrent jobs can't overspend.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS minutes_reserved INTEGER;

-- Hints for automatic name correction (the client's file name and the
-- container's title tag) and the title the corrector identified.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_name TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS media_title TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS detected_title TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_audio_sha256 ON jobs(audio_sha256);

-- Subtitles
CREATE TABLE IF NOT EXISTS subtitles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  language TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('srt', 'vtt')),
  object_key TEXT NOT NULL,
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subtitles_job_id ON subtitles(job_id);

-- One row per (job, language, format). Older builds could insert duplicates on
-- a retried/double-enqueued job; drop them before adding the constraint.
DELETE FROM subtitles a USING subtitles b
  WHERE a.job_id = b.job_id AND a.language = b.language AND a.format = b.format
    AND a.created_at > b.created_at;
DELETE FROM subtitles a USING subtitles b
  WHERE a.job_id = b.job_id AND a.language = b.language AND a.format = b.format
    AND a.created_at = b.created_at AND a.id > b.id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subtitles_job_lang_format
  ON subtitles (job_id, language, format);

-- Promo codes
CREATE TABLE IF NOT EXISTS promo_codes (
  code TEXT PRIMARY KEY,
  minutes_amount INTEGER NOT NULL,
  max_redemptions INTEGER,          -- NULL = unlimited
  expires_at TIMESTAMPTZ,           -- NULL = never expires
  note TEXT,                        -- e.g. "HN launch March 2026"
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Promo redemptions (one per user per code)
CREATE TABLE IF NOT EXISTS promo_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  code TEXT NOT NULL REFERENCES promo_codes(code),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, code)
);

-- Media cache (deduplication)
CREATE TABLE IF NOT EXISTS media_cache (
  audio_sha256 TEXT NOT NULL,
  language TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'transcribe',
  subtitle_srt_key TEXT,
  subtitle_vtt_key TEXT,
  transcript_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hit_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (audio_sha256, language, mode)
);
