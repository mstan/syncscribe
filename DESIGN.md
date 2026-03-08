# DESIGN.md – Simple SPA UX (Plex Subtitle Generator)

## Goal

A **dead-simple**, creator-tool style experience:
- Google sign-in
- single page app
- landing page = big upload dropzone
- minimal clicks, minimal settings, fast results
- pay-on-demand credits

Think: “top-of-google conversion site” UX, but for subtitles.

---

## Primary user journey

### 1) First visit
- User lands on `/`
- They see:
  - App name
  - One-line value prop: “Generate accurate subtitles for your media in minutes.”
  - Big drag-and-drop upload area
  - “Sign in with Google” button (if not signed in)
  - Small “Pricing” + “How it works” links

If user tries to upload while signed out:
- show a modal: “Sign in to generate subtitles”
- single CTA: “Continue with Google”

### 2) Signed-in landing state
On sign-in, the page stays the same, but now shows:
- credits remaining (top right)
- “Buy credits” button
- upload dropzone remains central

### 3) Upload → Extract audio → Create job
After the file is selected:
- immediately show:
  - file name
  - a progress bar (audio extraction)
  - estimated time (optional; can omit to keep it simple)
- run `ffmpeg.wasm` in a Web Worker to extract audio to:
  - mono, 16khz, FLAC (default)

When extraction finishes:
- automatically create a job via API
- upload audio to the presigned URL
- automatically enqueue and begin processing

No extra “Next” step unless upload fails.

### 4) Results
When done, show:
- success banner
- download buttons:
  - Download SRT
  - Download VTT
- optional: “Copy transcript” (if you store transcript)
- optional: “Generate another” (just reset UI)

Also show a small history list of recent jobs (optional MVP+):
- last 5 jobs with status and download links

---

## UI components (React SPA)

### Page layout
Single page with 3 zones:
1. Top bar:
   - logo/name left
   - right side:
     - credits remaining
     - “Buy credits”
     - user avatar dropdown (sign out)
2. Main center:
   - upload dropzone (primary)
   - job progress / status transitions
3. Footer:
   - “How it works”
   - “Privacy”
   - “Pricing”
   - “Support”

### Components
- `AppShell`
- `TopBar`
- `UploadDropzone`
- `JobProgress`
- `ResultPanel`
- `BuyCreditsModal` (or navigate to checkout)
- `AuthGate`

---

## UX states

### UploadDropzone states
1. **Idle**
   - big dropzone
   - “Click or drop a video file”
   - small accepted formats note: “MKV, MP4, AVI…”
2. **Extracting audio**
   - spinner + progress bar
   - “Extracting audio locally…”
3. **Uploading audio**
   - progress bar
   - “Uploading audio…”
4. **Processing**
   - “Generating subtitles…”
   - job status polling
5. **Complete**
   - download buttons
6. **Error**
   - short error message
   - “Try again”
   - if extraction fails: suggest converting to MP4 or provide “Upload audio file instead” advanced option

---

## Minimal settings (keep hidden by default)

Default behavior:
- Language: Auto (or user selects from a small dropdown)
- Mode: Transcribe (default), Translate (toggle)

To keep the UI clean:
- Hide settings behind an “Advanced” link.
- Advanced options (later):
  - model size (fast/accurate)
  - speaker labels
  - max line length presets

MVP can ship with **no advanced settings**:
- language = auto
- output = both SRT and VTT

## Additional Languages (multi-language jobs)

After selecting a primary language, users can optionally add extra languages:
- Show a “+ Add languages” link below the primary language selector
- Opens a multi-select of common languages (Spanish, French, Korean, Japanese, etc.)
- Each additional language is clearly shown as **50% credit rate**
- Before job creation, show a cost breakdown:
  - “English (primary): 22 min”
  - “Spanish (translation): 11 min”
  - “Korean (translation): 11 min”
  - “Total: 44 min”
- This incentivizes users to add translations in one go (cheaper than separate jobs)

Rationale: The primary language requires Whisper transcription (expensive).
Additional languages are LLM text-to-text translation (cheap), so the
discount reflects actual cost savings passed to the user.

---

## Auth (Google)

Use Google OAuth via:
- **Auth.js** on backend for session/JWT issuance
- front-end uses a single “Continue with Google” button

Recommended approach:
- Backend manages OAuth exchange and sets httpOnly cookie session (simple for SPA)
- Or JWT in local storage (less ideal)

MVP path:
- cookie-based session with CSRF protection for state-changing routes

---

## Credits purchase UX (Stripe)

Top bar shows:
- “Credits: 420 min”
- “Buy credits”

Click “Buy credits”:
- show modal with packs (3–4 options)
- user picks pack → redirect to Stripe Checkout
- return to `/` with success toast
- credits auto-refresh from API

Key behavior:
- If user has insufficient credits when a job starts:
  - block job creation
  - prompt “Buy credits”

---

## Job status UX

Backend job states:
- `awaiting_upload`
- `queued`
- `running`
- `succeeded`
- `failed`

Frontend polling:
- poll `GET /jobs/:id` every 1–2 seconds while `queued/running`
- when `succeeded`, show download buttons

---

## Privacy and messaging (important for Plex users)

Provide a short privacy note near the dropzone:
- “We extract audio locally in your browser. We upload only the audio track for transcription.”

Optional tooltip:
- “Audio may be retained briefly for processing; subtitles are cached for speed.”
- (You can clarify public vs private caching policy later)

---

## File handling and limitations (simple messaging)

Add a small line under dropzone:
- “Best on desktop. Large files may take a bit to process.”

No mobile optimization required; desktop-first.

---

## Pages / routes (still a SPA)

- `/` (main upload + results)
- `/pricing` (static)
- `/privacy` (static)
- `/account` (optional; view purchases/usage)

MVP can keep everything in `/` plus a couple simple static routes.

---

## What Claude should build (front-end)

Tech choices:
- React SPA (Vite recommended)
- Tailwind (optional)
- A single-page “tool site” feel
- `ffmpeg.wasm` in a Web Worker
- API client class, e.g. `lib/ApiClient.js`
- Auth integration for Google sign-in

Deliverable expectation:
- Clean, minimal UI with very few moving parts
- Works well with the backend service architecture (Express + services)

---

## Success criteria for UX

- A new user can:
  1) sign in with Google
  2) upload a video
  3) wait
  4) download SRT
…in under ~30 seconds of thinking / clicking.

No complicated settings, no multi-step wizards.
