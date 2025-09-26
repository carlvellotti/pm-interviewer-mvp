# Workings

This document summarizes how the two projects in this workspace are structured and how they work together, with a focus on the realtime interview flow.

## Projects

- **Full‑stack prototype** in `interview-bot-test/`
  - **Backend**: `server/` (Express + OpenAI + SQLite persistence)
  - **Frontend**: `client/` (React + Vite, WebRTC to OpenAI Realtime)
- **TypeScript UI demo** in `91363a6b-c3c6-44f9-8cf7-3dd5a2323680/`
  - Standalone Vite + React + TypeScript mock that simulates transcripts (no backend wiring)

---

## Development Workflow Overview

Development still leans on `vercel dev` for a production-like experience, but the canonical local backend now lives in the Express app (`server/`) so we can persist interviews to SQLite. Recommended setup:

- **Architecture**
  - `client/`: React SPA with a sidebar listing saved interviews and a main workspace for the live or historical session.
  - `server/`: Express 5 + `better-sqlite3` for REST endpoints, local persistence, and OpenAI calls.
  - `api/`: Vercel serverless functions for the hosted deployment; Express feature-parity lets us run everything locally without Vercel.
- **Local commands**
  1. `cd server && npm start` – starts Express on `http://localhost:4000`, auto-creates `data/interviews.db` (ignored by git).
  2. In another terminal either run `vercel dev` from repo root *or* `cd client && npm run dev`. In both cases the client ultimately talks to the Express server (see rewrites below).
- **`vercel dev` rewrites**: `vercel.json` maps `/api/:path*` to `http://localhost:4000/:path*`, so the browser can call `/api/...` during local development and hit Express without CORS errors.

---

## Backend (interview-bot-test/server)

Entry: `server/index.js` (Express 5, CORS, dotenv, `openai` SDK, SQLite persistence)

### Environment and defaults
- `OPENAI_API_KEY` (required)
- `REALTIME_MODEL` (default `gpt-4o-realtime-preview-2024-12-17`)
- `REALTIME_VOICE` (default `alloy`)
- `REALTIME_TRANSCRIBE_MODEL` (default `gpt-4o-mini-transcribe`)
- Listens on `PORT` (default `4000`)

### Interview content
- In-memory `questionBank` with 6 behavioral prompts
- `evaluationFocus`: brief coaching criteria
- `personas`: `easy`, `medium`, `hard` with voices, tone instructions, and turn-detection overrides

### Key endpoints
- `GET /health` – status check
- `GET /questions` – `{ questions, evaluationFocus, personas, defaults }`
- `POST /interview/start` – seeds messages and gets an initial interviewer reply
- `POST /interview/respond` – continues the conversation
- `POST /interview/summary` – produces coaching JSON from the transcript
- `POST /interview/save` – persists transcript, evaluation, metadata to SQLite
- `GET /interview/history` – returns interview summaries ordered newest-first
- `GET /interview/history/:id` – loads full transcript/evaluation payload
- `POST /realtime/session` – creates a Realtime client secret for the browser

### SQLite repository
- File lives at `data/interviews.db` (plus WAL files) created automatically.
- `server/interviewStore.js` manages schema creation and CRUD helpers using `better-sqlite3`.
- Tables store `title`, timestamps, metadata JSON, transcript JSON, evaluation JSON, and evaluation summary string.

### Notes
- Uses Node’s global `fetch` for OpenAI REST calls (Node 18+)
- Express JSON + CORS middleware
- WAL mode enabled for better concurrent-read performance; database ignored by git.

---

## Frontend (interview-bot-test/client)

Entry: `client/src/App.jsx` (React + Vite)

### Configuration
- Backend base URL determined at runtime:
  - If `VITE_API_BASE_URL` is set, it’s used (with trailing slash trimmed).
  - Otherwise, localhost builds default to `http://localhost:4000`; hosted builds fall back to `/api`.
- On load, fetches `GET /questions` to populate questions, personas, defaults.

### Realtime voice flow (browser)
1. User clicks Start → `POST /realtime/session` with `{ questionIds, difficulty }`
2. Backend responds with session instructions, model, client secret
3. Browser gets mic access with `navigator.mediaDevices.getUserMedia`
4. Creates an `RTCPeerConnection` + `oai-events` data channel
5. Sends SDP offer to OpenAI Realtime endpoint with `Authorization: Bearer <clientSecret>`
6. Applies answer, data channel opens
7. Sends `session.update` with instructions, then conversation seed “Begin the interview now.” + `response.create`

### Event handling
- Same as before: absorbs message/transcription events and renders conversation.
- When the assistant emits `INTERVIEW_COMPLETE`, or the user manually ends the session after some conversation, the app tears down WebRTC, calls `POST /interview/summary`, and persists the session via `/interview/save`.

### UI states & layout
- Modes: `idle` → `connecting` → `in-progress` → `complete`
- Left sidebar (new):
  - “New Interview” button to return to live mode.
  - List of saved interviews sorted newest-first (title + timestamp + summary snippet).
- Main workspace:
  - Live mode: question/difficulty config + visualization/transcript panel.
  - History mode: read-only transcript and evaluation sections for the selected interview.
- Responsive adjustments ensure layout stacks vertically on narrow screens.

### Live audio visualization
- Same circular analyser as before; idle state rendered when not in progress.

---

## How to run

### Backend
```bash
cd server
npm install
npm start  # http://localhost:4000
```

### Frontend (option 1: Vercel + rewrites)
```bash
cd /path/to/repo
vercel dev  # serves frontend, proxies /api/* → http://localhost:4000/*
```

### Frontend (option 2: Vite dev server)
```bash
cd client
npm install
npm run dev  # typically http://localhost:5173
```
If you use the Vite dev server, set `VITE_API_BASE_URL=http://localhost:4000` in `client/.env.local` or export it before running.

---

## Deployment (Vercel)

- `vercel.json` now includes a rewrite: `/api/:path*` → `http://localhost:4000/:path*` for local development parity.
- Production deploys still rely on the `api/` serverless functions; ensure they stay in sync with Express endpoints.
- Environment variables:
  - Server: `OPENAI_API_KEY` (required), optional overrides for models/voice.
  - Frontend: set `VITE_API_BASE_URL=/api` in production so the SPA calls Vercel APIs.

---

## TypeScript UI demo (separate folder)

Folder: `91363a6b-c3c6-44f9-8cf7-3dd5a2323680/`

- Vite + React + TypeScript UI with Tailwind-style classes
- Components: `QuestionSelector`, `DifficultySelector`, `TranscriptArea`, `InterviewControls`
- Simulates transcript updates (no backend). Could be wired to the Express/Vercel APIs if needed.

---

## Pointers to key files
- Backend (local): `server/index.js`, `server/interviewStore.js`
- Frontend: `client/src/App.jsx`, `client/src/redesign.css`
- Serverless API (Vercel production): `api/`
- Deployment spec: `vercel.json`, `DEPLOYMENT.md`
- API reference notes: `Realtime API.md`

