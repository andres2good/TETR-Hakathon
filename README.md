# Echo by Ecolocation

> AI voice assistant that controls your Chrome browser hands-free. Say "Echo" to activate — it navigates, clicks, types, and reads the web for you.

Built for people who are blind, have low vision, or reduced mobility.

---

## What it does

Echo listens for your voice, understands what you want, and controls the browser for you:

- "Open Gmail and send an email to mom saying I'll be home late"
- "Search for Bruno Mars on YouTube Music"
- "Open YouTube and search for cooking tutorials"
- "Close this tab"
- "Switch to my Gmail tab"

---

## Architecture

```
Voice → Deepgram Nova-3 (transcription)
      → Claude Sonnet 4.6 (understands + decides)
      → Chrome extension (clicks, types, navigates)
      → Cartesia Sonic-3.5 (speaks the response)
```

---

## Project Structure

```
TETR-Hakathon/
├── server/          Node.js backend (Express + WebSocket)
│   └── src/
│       ├── session/ Session management, speech queue
│       ├── llm/     Claude integration, tools, system prompt
│       ├── stt/     Deepgram live transcription
│       ├── tts/     Cartesia text-to-speech
│       └── storage/ Supabase (optional)
├── extension/       Chrome extension (Manifest V3)
│   ├── sidepanel.js WebSocket client, mic, auth, audio
│   ├── content.js   UI tree extraction, click/type actions
│   ├── background.js Opens side panel on click
│   └── icons/       PNG icons (16/48/128px)
├── website/         Landing page + pricing
│   ├── index.html   Full site with Spline robot, plans, PayPal
│   └── logo.jpeg    Ecolocation logo
└── desktop/         Python desktop client (alternative to extension)
```

---

## Running locally

**1. Start the server**
```bash
cd server
node src/index.js
```

Requires a `.env` file (copy from `.env.example`):
```
ANTHROPIC_API_KEY=...
DEEPGRAM_API_KEY=...
CARTESIA_API_KEY=...
CARTESIA_VOICE_ID=...
CARTESIA_MODEL=sonic-3.5
APP_SECRET_KEY=tetr-secret-2024-xK9mPqR7
```

**2. Load the extension**
1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Click the Echo icon → side panel opens

---

## Deployment

| Component | Platform | URL |
|-----------|----------|-----|
| Backend server | Railway | `https://tetr-hakathon-production.up.railway.app` |
| Website | Hostinger | `https://echolocation.squarefire.com.mx` |
| Extension | Chrome Web Store | Pending review |

**Railway environment variables required:**
- `ANTHROPIC_API_KEY`
- `DEEPGRAM_API_KEY`
- `CARTESIA_API_KEY` + `CARTESIA_VOICE_ID` + `CARTESIA_MODEL=sonic-3.5`
- `APP_SECRET_KEY`
- `NODE_ENV=production`

Railway root directory must be set to `/server`.

---

## Key technical decisions

- **WebSocket audio streaming** — raw PCM 16kHz sent from extension → server → Deepgram in real time
- **UI tree over screenshots** — content.js builds a text map of the page (buttons, links, fields) so Claude doesn't need to see pixels to act
- **Speech queue** — TTS runs async without blocking the Claude streaming connection (fixed mid-session crashes)
- **Lone surrogate fix** — pages like YouTube embed invalid Unicode in their DOM; stripped before sending to Anthropic API
- **Supabase optional** — server starts without credentials; history logging just disabled
- **Token refresh** — JWT auto-refreshes on 401 so sessions stay alive across browser restarts

---

## What was built (session log)

### Session 1 (2026-05-24)
- Core voice pipeline: Deepgram → Claude → Cartesia
- Chrome extension with side panel, wake word detection, mic capture
- UI tree extraction for all interactive elements
- All browser control tools: click, set_text, navigate, open_app, scroll, tabs, etc.
- Gmail compose via direct URL method

### Session 2 (2026-05-25)
- Renamed assistant from NAVI → **Echo**
- Fixed Node.js 20 WebSocket issue in Supabase client
- Removed inline onclick handlers (Chrome Extension CSP fix)
- Token refresh for persistent login across restarts
- Moved plans/pricing entirely to website (extension just shows activate screen)
- Built and deployed **website** with Spline 3D robot, Cormorant Garamond font, silver/dark theme
- Added **Ecolocation logo** (bat + echolocation waves) to navbar, footer, favicon
- Deployed server to **Railway** (fixed root directory, env vars, Procfile)
- Published extension to **Chrome Web Store** (pending review)
- Fixed `cache_control` beta flag causing random Anthropic 400 errors
- Fixed TTS blocking Claude's streaming connection (async speech queue)
- **Root fix**: lone Unicode surrogates from YouTube/emoji-heavy pages caused `invalid_request_error` — now stripped on ingest

---

## Team

Built by **Ecolocation** — making the web accessible through voice.

Website: [echolocation.squarefire.com.mx](https://echolocation.squarefire.com.mx)
