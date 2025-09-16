# Workings

This document summarizes how the two projects in this workspace are structured and how they work together, with a focus on the realtime interview flow.

## Projects

- **Full‑stack prototype** in `interview-bot-test/`
  - **Backend**: `server/` (Express + OpenAI)
  - **Frontend**: `client/` (React + Vite, WebRTC to OpenAI Realtime)
- **TypeScript UI demo** in `91363a6b-c3c6-44f9-8cf7-3dd5a2323680/`
  - Standalone Vite + React + TypeScript mock that simulates transcripts (no backend wiring)

---

## Backend (interview-bot-test/server)

Entry: `server/index.js` (Express 5, CORS, dotenv, `openai` SDK)

### Environment and defaults
- `OPENAI_API_KEY` (required)
- `REALTIME_MODEL` (default `gpt-4o-realtime-preview-2024-12-17`)
- `REALTIME_VOICE` (default `alloy`)
- `REALTIME_TRANSCRIBE_MODEL` (default `gpt-4o-mini-transcribe`)
- Listens on `PORT` (default `4000`)

### Interview content
- In‑memory `questionBank` with 6 behavioral prompts
- `evaluationFocus`: brief coaching criteria
- `personas`: `easy`, `medium`, `hard` with:
  - `voice` selection, tone/instructions, and turn‑detection overrides

### Key endpoints
- `GET /health`
  - Simple status check
- `GET /questions`
  - Returns `{ questions, evaluationFocus, personas, defaults }`
- `POST /interview/start`
  - Seeds a messages array and gets an initial interviewer reply via `gpt-4o-mini`
- `POST /interview/respond`
  - Continues the chat conversation via `gpt-4o-mini`
- `POST /interview/summary`
  - Produces coaching JSON from a transcript assembled from conversation messages
- `POST /realtime/session`
  - Creates a Realtime client secret via `POST /v1/realtime/client_secrets`
  - Responds with `{ clientSecret, expiresAt, model, baseUrl, instructions, persona, questions }`

### Realtime session config
- Session body (server‑side) sets:
  - `session.type = "realtime"`, `session.model = REALTIME_MODEL`
  - `session.instructions` = persona‑aware interviewer system prompt
  - `session.audio.input.transcription.model` = `REALTIME_TRANSCRIBE_MODEL`
  - `session.audio.input.turn_detection` = persona overrides merged with defaults
  - `session.audio.output.voice` = persona voice

### Notes
- Uses Node’s global `fetch` for OpenAI REST calls (Node 18+)
- Express 5 middleware: JSON + CORS

---

## Frontend (interview-bot-test/client)

Entry: `client/src/App.jsx` (React + Vite)

### Configuration
- Backend base URL: `VITE_API_BASE_URL` (defaults to `http://localhost:4000`)
- On load, fetches `GET /questions` to populate:
  - Multi‑select question list
  - Personas (`easy`, `medium`, `hard`)
  - Default selection and difficulty

### Realtime voice flow (browser)
1. User clicks Start → `POST /realtime/session` with `{ questionIds, difficulty }`
2. Backend responds with `clientSecret`, `model`, `baseUrl`, and `instructions`
3. Browser gets mic access via `navigator.mediaDevices.getUserMedia({ audio: true })`
4. Creates `RTCPeerConnection` and an `oai-events` data channel
5. Sends local SDP to `baseUrl` (default `https://api.openai.com/v1/realtime/calls?model=...`) with `Authorization: Bearer <clientSecret>`
6. Applies remote SDP answer; data channel opens
7. Sends `session.update` with interviewer instructions, then seeds a user message “Begin the interview now.” and `response.create`

### Event handling
The app processes GA‑style Realtime events on the data channel, including:
- `conversation.item.created|added` (message items)
- `conversation.item.input_audio_transcription.*`
- `response.output_text.delta|done`
- `response.output_audio_transcript.delta|done`

Messages are accumulated and rendered in order. When the assistant emits `INTERVIEW_COMPLETE`, the app:
- Tears down WebRTC
- Calls `POST /interview/summary` with the conversation
- Renders coaching feedback (summary, strengths, improvements)

### UI states
- `idle` → `connecting` → `in-progress` → `complete`
- Microphone indicator, transcript list, and summary panel

### Live audio visualization
- A radial ring visualizer renders when the session is `in-progress`.
- Audio source: the remote `MediaStream` from `RTCPeerConnection.ontrack`.
- Web Audio graph: `MediaStreamAudioSourceNode → AnalyserNode` (time + frequency data; no connection to `destination` to avoid double audio).
- Rendering: a `<canvas>` fills the gray/blue visualization panel via a container + `ResizeObserver` (accounts for device pixel ratio). Bars are log‑spaced around a circle; a center pulse reflects RMS loudness.
- Lifecycle: initialized when the remote track arrives; cancelled and disconnected on end/reset or when the remote track ends. A shared `AudioContext` is created/resumed after the user starts the session.
- Note: The temporary “Visualizer Playground” (local MP3 demo) was removed once the live visualizer was confirmed working.

---

## How to run

### Backend
```bash
cd server
npm install
npm start
# listens on http://localhost:4000
```
Add `.env` at repo root with:
```bash
OPENAI_API_KEY=your_api_key
# Optional
REALTIME_MODEL=gpt-4o-realtime-preview-2024-12-17
REALTIME_VOICE=alloy
REALTIME_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
```

### Frontend
```bash
cd client
npm install
npm run dev
# Vite serves on printed port (typically 5173)
```
Optional client `.env` (inside `client/`) to point at a different backend:
```bash
VITE_API_BASE_URL="https://your-server-url"
```

---

## TypeScript UI demo (separate folder)

Folder: `91363a6b-c3c6-44f9-8cf7-3dd5a2323680/`

- Vite + React + TypeScript UI with Tailwind‑style classes
- Components: `QuestionSelector`, `DifficultySelector`, `TranscriptArea`, `InterviewControls`
- Simulates transcript updates in `App.tsx` (no backend or Realtime integration)
- Can be wired to the backend by calling `POST /realtime/session` and adopting the WebRTC flow used in `client/src/App.jsx`

---

## Pointers to key files
- Backend: `server/index.js`
- Frontend: `client/src/App.jsx`
- API reference notes: `Realtime API.md` (in repo root and also inside `interview-bot-test/`)

