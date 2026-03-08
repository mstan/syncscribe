# AI Subtitle Generator -- System Summary

## Overview

This application allows users (primarily Plex / self-hosted media users)
to upload a video file and generate subtitles using Whisper-based
transcription.

Key design goals:

-   Pay-on-demand credit model (no subscriptions)
-   Client-side video processing to extract audio
-   Server-side transcription using Whisper
-   Efficient caching to reduce compute cost
-   Simple, transparent billing based on audio duration
-   Support for reuse of previously generated subtitles

Users upload video → browser extracts audio → server transcribes →
subtitles returned.

------------------------------------------------------------------------

# Product Model

## Target Users

Primary users:

-   Plex / Jellyfin media server users
-   Home media collectors
-   People with large libraries missing subtitles
-   Users without GPUs who cannot run Whisper locally

Typical use cases:

-   Generate subtitles for entire TV seasons
-   Fix missing subtitles for rare media
-   Batch generate subtitles for Plex libraries

------------------------------------------------------------------------

# Pricing Model

Credits are based on **minutes of audio processed**.

Example pricing:

  Pack       Price   Minutes
  ---------- ------- --------------
  Starter    \$5     150 minutes
  Standard   \$15    600 minutes
  Large      \$40    2000 minutes

Charging rules:

-   Charge **per minute of audio**
-   Rounded to nearest 15--30 seconds
-   Charge **even if subtitle was served from cache**
-   Charge **only after job succeeds**

Cached responses still deduct credits because the service is billed for
delivery, not compute.

## Additional Language Discount

When a user requests subtitles, the **first language** (primary transcription
via Whisper) is charged at the **full rate**. Any **additional languages**
requested on the same file are charged at **50% of the full rate**.

Rationale:
-   The primary language requires Whisper transcription (compute-intensive)
-   Additional languages are LLM text-to-text translation (much cheaper)
-   The discount is passed on to users to incentivize multi-language jobs
-   This increases revenue per upload while keeping pricing fair

Example:
-   A 22-minute episode at full rate = 22 credits (minutes)
-   Adding Spanish translation = +11 credits (50%)
-   Adding Korean translation = +11 credits (50%)
-   Total for 3 languages = 44 credits instead of 66

This encourages users to generate all desired languages in a single job,
which is operationally efficient (audio only uploaded/processed once).

------------------------------------------------------------------------

# Core System Architecture

## Client Flow

1.  User uploads video file
2.  Browser runs **ffmpeg.wasm**
3.  Audio extracted from video
4.  Audio converted to Whisper-friendly format:

```{=html}
<!-- -->
```
    mono
    16khz
    FLAC or WAV

Example ffmpeg command:

    ffmpeg -i input.mkv -vn -ac 1 -ar 16000 -c:a flac output.flac

5.  Browser uploads extracted audio to backend
6.  Backend processes transcription job

This avoids uploading large video files and improves privacy.

------------------------------------------------------------------------

# Backend Processing Flow

1.  Client submits job request
2.  Backend computes `audio_sha256`
3.  Check cache table for existing subtitles
4.  If cache exists:

```{=html}
<!-- -->
```
    return subtitles immediately
    charge credits
    mark job as cached

5.  If cache does not exist:

```{=html}
<!-- -->
```
    enqueue transcription job
    worker processes Whisper
    store results
    update cache
    charge credits
    return subtitles

------------------------------------------------------------------------

# Object Storage (R2)

Use Cloudflare R2 for storing audio and subtitle artifacts.

Object layout:

    audio/{audio_sha256}.flac
    subs/{audio_sha256}/en/srt
    subs/{audio_sha256}/en/vtt
    transcripts/{audio_sha256}.json

Benefits:

-   deduplication
-   cheap storage
-   CDN caching for downloads
-   easy lookup

Audio files can optionally be deleted after job completion to reduce
storage.

------------------------------------------------------------------------

# Postgres Database Schema

## Users

    users
    -----
    id (uuid)
    email
    password_hash
    created_at

## API Keys (optional)

    api_keys
    --------
    id
    user_id
    key_hash
    name
    created_at
    revoked_at

## Credit Packs

    credit_packs
    ------------
    id
    name
    minutes_amount
    price_cents
    active

## Purchases

Tracks Stripe payments.

    purchases
    ---------
    id
    user_id
    provider
    provider_checkout_session_id
    provider_payment_intent_id
    pack_id
    price_cents
    currency
    status
    created_at

## Credit Ledger

Ledger-based system instead of balance column.

    credit_ledger
    -------------
    id
    user_id
    type
    minutes_delta
    job_id
    purchase_id
    note
    created_at

Example entries:

    +150 minutes purchase
    -22 minutes job debit
    +10 minutes promo credit

User balance:

    SUM(minutes_delta)

## Jobs

Tracks transcription tasks.

    jobs
    ----
    id
    user_id
    status
    media_hash
    audio_object_key
    audio_seconds
    minutes_charged
    cached_hit
    language
    mode
    model
    error_code
    error_message
    created_at
    started_at
    finished_at

## Subtitles

Stores subtitle outputs.

    subtitles
    ---------
    id
    job_id
    format
    object_key
    sha256
    created_at

Formats supported:

    srt
    vtt

## Media Cache

Used to avoid recomputation.

    media_cache
    -----------
    media_hash
    language
    mode
    subtitle_object_key
    transcript_object_key
    created_at
    last_accessed_at
    hit_count

Unique key:

    (media_hash, language, mode)

------------------------------------------------------------------------

# Hashing Strategy

The system uses **audio hashing** for deduplication.

Client computes:

    sha256(audio_bytes)

This hash becomes:

    media_hash

Benefits:

-   identical uploads dedupe automatically
-   fast lookup
-   avoids reprocessing

------------------------------------------------------------------------

# Worker System

Worker tasks:

1.  Download audio from R2
2.  Run Whisper transcription
3.  Generate subtitle formats
4.  Upload results to R2
5.  Update media_cache
6.  Mark job completed
7.  Write credit debit entry

Jobs should be **idempotent**.

Example constraint:

    unique(job_id) in credit_ledger for job_debit

------------------------------------------------------------------------

# API Endpoints (Example)

Create job:

    POST /jobs

Response:

    job_id
    upload_url

Upload audio to presigned R2 URL.

Check job status:

    GET /jobs/{job_id}

Download subtitles:

    GET /jobs/{job_id}/subtitles

------------------------------------------------------------------------

# Security Considerations

-   Never store raw API keys
-   Store hashed keys only
-   Validate file sizes
-   Rate limit job creation

Example limits:

    max concurrent jobs per user
    max minutes per job
    max minutes per hour

------------------------------------------------------------------------

# Future Features

Possible improvements:

-   multi-language subtitle generation
-   subtitle translation
-   speaker detection
-   subtitle timing correction
-   batch library scanning
-   Plex/Jellyfin integration agent
-   subtitle editing UI

------------------------------------------------------------------------

# Key Design Principles

1.  Compute once, reuse forever
2.  Credits instead of subscriptions
3.  Charge consistently regardless of caching
4.  Client-side audio extraction to reduce bandwidth
5.  Ledger-based accounting for reliability
6.  Object storage for scalable artifacts

------------------------------------------------------------------------

# High Level Flow

    User Uploads Video
            ↓
    Browser extracts audio (ffmpeg.wasm)
            ↓
    Upload audio to API
            ↓
    Compute audio hash
            ↓
    Check cache
            ↓
    Cache hit → return subtitles
    Cache miss → run Whisper
            ↓
    Store subtitles
            ↓
    Charge credits
            ↓
    Return result

------------------------------------------------------------------------

# Summary

This system provides a scalable, pay-on-demand subtitle generation
service targeted at Plex and self-hosted media users.

The architecture prioritizes:

-   low server bandwidth
-   efficient caching
-   simple billing
-   high compute reuse

The result is a system that becomes **more profitable as its subtitle
cache grows**.
