# Workings

This document summarizes how the two projects in this workspace are structured and how they work together, with a focus on the realtime interview flow.

## Recent Updates (September 2025)

**Interview Categories System**: Major refactor from free-form question selection to category-first approach:
- **5 structured interview categories** with 60 curated PM questions
- **Rich AI guidance** per category (pacing, probing, evaluation signals)
- **Category-first UI** with accordion-style selection (expand one category at a time)
- **Inline duration display** for each question (5-15 min) with total calculation
- **Backward-compatible API** supporting both new (categoryId + questionIds) and old (questionStack) formats
- **CSS Design System** with variables and utility classes for consistent theming
- **Bug fixes**: Interview auto-restart issue, evaluation saving to history

See `docs/specs_completed/interview-categories.md` and `docs/initial_question_bank.md` for full details.

## Projects

- **Full‑stack prototype** in `interview-bot-test/`
  - **Backend**: `server/` (Express + OpenAI + SQLite persistence)
  - **Frontend**: `client/` (React + Vite, WebRTC to OpenAI Realtime)
- **TypeScript UI demo** in `91363a6b-c3c6-44f9-8cf7-3dd5a2323680/`
  - Standalone Vite + React + TypeScript mock that simulates transcripts (no backend wiring)

---

## Development Workflow Overview

**Current Deployment (Sept 2025):** Individual serverless functions in `api/` directory (see `docs/vercel-deployment-patterns.md` for the full story).

- **Architecture**
  - `client/`: React SPA with a sidebar listing saved interviews and a main workspace for the live or historical session.
  - `server/`: Express 5 + `better-sqlite3` for **local development only** (not deployed to Vercel).
  - `api/`: Individual serverless functions that handle all production API requests on Vercel.
- **Local development options**
  1. **Recommended:** `vercel dev` from repo root – simulates production environment, uses serverless functions in `api/`
  2. **Alternative:** `cd server && npm start` (Express on port 4000) + `cd client && npm run dev` – faster iteration but different from production
- **Note:** The Express server (`server/index.js`) is NOT deployed to Vercel. It's purely for local development convenience. Production uses the individual functions in `api/`.

---

## Backend

### Local Development Server (interview-bot-test/server)

**Note:** This Express server is for **local development only** and is NOT deployed to Vercel. Production uses individual serverless functions in `api/`.

Entry: `server/index.js` (Express 5, CORS, dotenv, `openai` SDK, SQLite persistence)

### Environment and defaults
- `OPENAI_API_KEY` (required)
- `REALTIME_MODEL` (default `gpt-4o-realtime-preview-2024-12-17`)
- `REALTIME_VOICE` (default `alloy`)
- `REALTIME_TRANSCRIBE_MODEL` (default `gpt-4o-mini-transcribe`)
- Listens on `PORT` (default `4000`)

### Interview content
- **Interview Categories System** (Sept 2025): 5 structured categories with 60 curated questions
  - **Behavioral**: 12 STAR-based questions (avg 8.3 min each)
  - **Execution / Delivery**: 12 project management questions (avg 6.2 min each)
  - **Metrics / Analytics**: 12 data-driven questions (avg 5.9 min each)
  - **Product Sense / Design**: 12 exploratory design questions (avg 13.8 min each)
  - **Strategy / Market**: 12 strategic thinking questions (avg 7.5 min each)
- Each category includes rich AI guidance:
  - `systemStyle`: Interviewer persona and tone
  - `questionApproach`: How to ask and probe
  - `pacing`: Timing guidelines for each question type
  - `probeFor`: Key areas to dig into
  - `avoid`: Anti-patterns to avoid
  - `evaluationSignals`: Strong vs weak answer indicators
- Question types: `rigid` (ask verbatim) or `exploratory` (collaborative problem-solving)
- `personas`: `easy`, `medium`, `hard` with voices, tone instructions, and turn-detection overrides

### Key endpoints
- `GET /health` – status check
- `GET /questions` – returns interview configuration
  - **NEW format**: `{ categories, personas }` where categories is array of 5 interview types with questions
  - **OLD format**: Still includes `{ questions, evaluationFocus, defaults }` for backward compatibility
- `POST /interview/start-session` – creates OpenAI Realtime session
  - **NEW format**: `{ categoryId, questionIds, difficulty, resumeRef }`
  - **OLD format**: `{ questionStack, difficulty, resumeRef, jdSummary }` still supported
  - Uses category-specific AI guidance to build rich system prompts
  - Returns: `{ session, questionStack, categoryId, categoryName, estimatedDuration, persona }`
- `POST /interview/summary` – produces coaching JSON from the transcript
- `POST /interview/save` – persists transcript, evaluation, metadata to SQLite
  - Accepts both `evaluation` (new) and `summary` (old) fields
- `GET /interview/history` – returns interview summaries ordered newest-first
- `GET /interview/history/:id` – loads full transcript/evaluation payload
- `POST /interview/jd` – processes job description and generates questions
- `POST /interview/resume` – uploads resume for context
- `GET /categories` – custom user categories (CRUD endpoints at `/categories/:id`)

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

Entry: `client/src/App.jsx` (React + Vite + Jotai state management)

**Architecture:** As of Sept 2025, the frontend has been refactored from a monolithic 1,428-line `App.jsx` into a modular component/hook architecture (see `docs/specs/app-refactor.md` for full details).

### Configuration
- Backend base URL determined at runtime:
  - If `VITE_API_BASE_URL` is set, it's used (with trailing slash trimmed).
  - Otherwise, localhost builds default to `http://localhost:4000`; hosted builds fall back to `/api`.
- On load, fetches `GET /questions` to populate questions, personas, defaults.

### Component Structure
- **`App.jsx`** (199 lines) - Root routing between prep/interview/history modes
- **`Sidebar.jsx`** - Persistent interview history sidebar (always visible)
- **`PrepWizard.jsx`** - Interview configuration flow
  - **Category-first approach** (Sept 2025): Accordion-style UI with 5 interview types
  - User selects ONE category → questions expand inline
  - Click to collapse → deselects all questions in that category
  - Shows per-question durations (e.g., "8 min")
  - Calculates total estimated duration in review stack
  - Keeps existing tabs: Upload JD, Custom Categories, Review Stack
- **Interview components:**
  - `InterviewView.jsx` - Live interview UI with audio visualization
  - `HistoryView.jsx` - Past interview detail viewer
  - `AudioVisualizer.jsx` - Real-time audio frequency visualization
  - `QuestionStack.jsx` - Question list display
  - `SessionDetails.jsx` - Session metadata card
- **Prep components:**
  - `QuestionSection.jsx` - Reusable question list with checkboxes (shows durations)
  - `CustomCategoriesSection.jsx` - User-created question categories
  - `ResumeUploader.jsx` - Resume upload and management
- **Custom hooks:**
  - `useInterviewHistory.js` - Interview list loading & detail fetching
  - `useRealtimeInterview.js` - WebRTC connection lifecycle management
  - `useInterviewMessages.js` - Real-time message parsing & transcript handling
- **Services:** `api.js` (REST calls), `webrtc.js` (WebRTC connection logic)
- **Utils:** `formatters.js` (date/time), `interviewHelpers.js` (prompts, parsing)

### Realtime voice flow (browser)
1. User clicks Start → `POST /interview/start-session` with:
   - **NEW format**: `{ categoryId, questionIds, difficulty, resumeRef }`
   - **OLD format**: `{ questionStack, difficulty, resumeRef, jdSummary }` (still works)
2. Backend builds rich system prompt using category AI guidance and responds with:
   - `session` (with clientSecret, expiresAt, model, instructions)
   - `questionStack` (questions to cover)
   - `categoryId`, `categoryName` (NEW)
   - `estimatedDuration` (NEW, calculated from selected questions)
   - `persona` (difficulty settings)
3. Browser gets mic access with `navigator.mediaDevices.getUserMedia`
4. Creates an `RTCPeerConnection` + `oai-events` data channel
5. Sends SDP offer to OpenAI Realtime endpoint with `Authorization: Bearer <clientSecret>`
6. Applies answer, data channel opens
7. Sends `session.update` with instructions, then conversation seed "Begin the interview now." + `response.create`

### Event handling
- Same as before: absorbs message/transcription events and renders conversation.
- When the assistant emits `INTERVIEW_COMPLETE`, or the user manually ends the session after some conversation, the app tears down WebRTC, calls `POST /interview/summary`, and persists the session via `/interview/save`.

### UI states & layout
- **App modes:** `prep` → `interview` → `history` (managed via `prepModeAtom`)
- **Interview status:** `idle` → `connecting` → `in-progress` → `complete`
- **Persistent sidebar** (`Sidebar.jsx`):
  - "New Interview" button clears selection and returns to prep mode
  - List of saved interviews sorted newest-first (title + timestamp + summary snippet)
  - Highlights currently selected interview when in history mode
  - Always visible across all modes
- **Main workspace** (conditional rendering):
  - **Prep mode:** `PrepWizard` component for configuration
  - **Interview mode:** `InterviewView` with live audio visualization/transcript panel
  - **History mode:** `HistoryView` with read-only transcript and evaluation
- **Responsive:** Layout stacks vertically on narrow screens

### State management (Jotai atoms)
- **Shared atoms** for sidebar/view synchronization:
  - `interviewListAtom` - Full interview list
  - `selectedInterviewIdAtom` - Currently selected interview ID
  - `selectedInterviewAtom` - Full detail data for selected interview
- **Prep atoms:** 
  - **Category atoms (NEW Sept 2025):**
    - `interviewCategoriesAtom` - 5 interview categories loaded from API
    - `selectedCategoryIdAtom` - Currently expanded category
    - `selectedCategoryAtom` - Derived: full category object with questions
  - `selectedQuestionIdsAtom` - Array of selected question IDs
  - `selectedQuestionsAtom` - Derived: full question objects (category-aware)
  - `prepSummaryAtom` - Derived: total questions + estimated duration
  - `reviewSettingsAtom` - Difficulty and persona selections
  - `resumeUploadAtom` - Resume file state
  - `jdUploadAtom` - Job description state and generated questions
  - `customCategoriesAtom` - User-created question categories
- **Interview atoms:** Session config, question stack, persona settings

### Live audio visualization
- Circular radial frequency bars + center pulse
- Receives `MediaStream` directly from `useRealtimeInterview` hook
- Self-contained component with internal AudioContext management
- Idle/static visualization when not in progress

### CSS Design System (Sept 2025)
- **CSS Variables** in `redesign.css` for consistent theming:
  - Backgrounds: `--bg-card-primary`, `--bg-card-hover`, `--bg-card-active`
  - Borders: `--border-default`, `--border-hover`, `--border-active`
  - Text: `--text-primary`, `--text-secondary`, `--text-accent`
  - Accents: `--accent-primary`, `--accent-gradient`
  - Spacing: `--spacing-xs` through `--spacing-xl`
  - Shadows: `--shadow-sm`, `--shadow-md`, `--shadow-lg`
  - Border radius: `--radius-sm`, `--radius-md`, `--radius-lg`
- **Utility Classes** for common patterns:
  - Text: `.text-primary`, `.text-secondary`, `.text-accent`
  - Backgrounds: `.bg-card`, `.bg-elevated`
  - Borders: `.border-default`, `.border-active`
  - Spacing: `.p-sm`, `.gap-md`, `.p-lg`
  - Shadows: `.shadow-sm`, `.shadow-lg`
- **Dark theme** with purple/indigo accents throughout
- All components use design tokens for consistency
- Single source of truth for theme updates

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

**Architecture:** Individual serverless functions (see `docs/vercel-deployment-patterns.md` for detailed explanation and alternatives).

- **API Structure:** Each route is a separate file in `api/` directory
  - `api/health.js` → `/api/health`
  - `api/categories/index.js` → `/api/categories`
  - `api/categories/[id].js` → `/api/categories/:id` (dynamic route)
  - `api/interview/history.js` → handles both `/api/interview/history` AND `/api/interview/history/:id` (via routes config)
  - etc.
- **Dynamic Route Handling:**
  - **Preferred approach:** Single flat file + `routes` config in `vercel.json`
  - **Why:** Directory-based dynamic routes (`[id].js`) are unreliable in `vercel dev`
  - **Pattern:** Use `routes` array to transform path params → query params
  - **Example:** `/api/interview/history/:id` → `/api/interview/history?id=:id`
  - See `docs/DEBUG-history-route-404.md` for detailed explanation
- **Database:** SQLite stored in `/tmp` (ephemeral, cleared periodically)
  - Acceptable for demo/MVP use case
  - Upgrade to Vercel Postgres/KV for persistence if needed
- **Environment variables:**
  - `OPENAI_API_KEY` (required)
  - Optional: `REALTIME_MODEL`, `REALTIME_VOICE`, `REALTIME_TRANSCRIBE_MODEL`
- **Build configuration:** See `vercel.json`
  - Installs root + client dependencies
  - Builds React app to `client/dist`
  - Auto-detects and deploys `api/` functions
  - **IMPORTANT:** Use `routes` (not `rewrites`) for API transformations
    - `rewrites` = client-side SPA routing
    - `routes` = server-side API transformations

---

## TypeScript UI demo (separate folder)

Folder: `91363a6b-c3c6-44f9-8cf7-3dd5a2323680/`

- Vite + React + TypeScript UI with Tailwind-style classes
- Components: `QuestionSelector`, `DifficultySelector`, `TranscriptArea`, `InterviewControls`
- Simulates transcript updates (no backend). Could be wired to the Express/Vercel APIs if needed.

---

## Pointers to key files

### Backend
- Express server: `server/index.js`, `server/interviewStore.js`
- Serverless API (Vercel production): `api/` (feature-parity with Express)

### Frontend
- Root: `client/src/App.jsx` (199 lines)
- Components: `client/src/components/` (Sidebar, PrepWizard, interview views)
- Hooks: `client/src/hooks/` (useInterviewHistory, useRealtimeInterview, useInterviewMessages)
- Services: `client/src/services/` (api, webrtc)
- Utils: `client/src/utils/` (formatters, interviewHelpers)
- State: `client/src/atoms/prepState.js` (Jotai atoms)
- Styles: `client/src/redesign.css`

### Documentation
- Architecture refactor spec: `docs/specs_completed/app-refactor.md`
- Interview categories spec: `docs/specs_completed/interview-categories.md` (Sept 2025)
- Interview history sidebar: `docs/specs_completed/interview-history-sidebar.md`
- Initial question bank research: `docs/initial_question_bank.md` (60 questions across 5 categories)
- Vercel deployment patterns: `docs/vercel-deployment-patterns.md`
- This file: `docs/workings.md`
- Deployment: `vercel.json`, `DEPLOYMENT.md`
- API reference: `Realtime API.md`

