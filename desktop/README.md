# QuizMind AI Desktop V0.1

QuizMind is now desktop-first. The Windows application wraps the existing answer workspace in Electron and moves model calls, API-key handling, and persistent user data into the main process.

## Stack

- Electron 45.4.1 (stable line; Windows desktop runtime)
- electron-builder 26.18.1 (NSIS installer + portable EXE)
- PDF.js 6.5.438 (bundled locally for PDF text extraction)
- Existing HTML/CSS/JavaScript answer and ingestion UI, reused rather than rewritten.
- A secure standard app:// protocol serves local assets and the matching PDF.js worker without relying on file:// worker behavior.

## Requirements

- Windows 10/11 x64 for the first packaged release.
- Node.js 24.x for development/build.
- npm.

## Run locally

~~~powershell
cd desktop
npm install
npm start
~~~

## Run tests

~~~powershell
cd desktop
npm test
~~~

## Build Windows packages

~~~powershell
cd desktop
npm run dist:win
~~~

Outputs are written to desktop/dist/:

- NSIS installer (QuizMind AI Setup EXE)
- Portable Windows executable (QuizMind AI EXE)

The first build downloads Electron and npm dependencies. The app itself runs locally after installation; an internet connection is only required for remote model APIs and external source links. A local OpenAI-compatible model endpoint such as Ollama can also be configured.

## Model configuration

Open AI 设置 in the app and enter:

- API Base URL, for example https://api.openai.com/v1.
- Model ID supplied by the provider.
- API Key.

Remote endpoints must use HTTPS. HTTP is allowed only for localhost services. The API Key is encrypted with Electron safeStorage on Windows and is never exposed to renderer JavaScript.

## Local data

- Question bank and imported knowledge documents are stored under Electron's per-user userData directory.
- PDF/TXT files are parsed locally.
- Only the selected question and retrieved A/B authority evidence snippets are sent to the configured model provider.
- Without a model API, local verified-question matching and local evidence search remain available.

## Architecture

- main.cjs: window lifecycle, IPC handlers, local persistence, secure settings, model calls.
- preload.cjs: narrow contextBridge API; no Node.js access from renderer.
- answer-engine.cjs: evidence-constrained inference and answer validation.
- docs/quiz/: reused answer UI, question-bank importer, knowledge ingestion, and the packaged settings page.
- scripts/prepare-assets.cjs: copies pinned PDF.js legacy modules into the renderer asset directory before start/build.

## Current limitations

- The built-in verified question bank is empty pending review of the original official source PDF.
- The 50-module taxonomy remains provisional until verified against the exact official PDF revision.
- Scanned-PDF OCR, live web search, and automatic database verification are not included in V0.1.
- The Windows installer is unsigned; Windows SmartScreen may show an unknown-publisher warning until code signing is configured.
- Cloud model usage may incur provider charges. Test requests and answer requests use the configured provider account.

## Security notes

- contextIsolation: true, nodeIntegration: false, and a sandboxed renderer are enabled.
- Local renderer assets are served from a scoped app://quizmind origin; path traversal and navigation outside the app origin are blocked.
- Renderer can access only the explicit methods exposed by preload.cjs.
- Remote links are restricted to HTTPS and opened in the system browser.
- API secrets are encrypted through OS-backed safeStorage; plaintext keys are never written to the app's JSON settings file.
- Local model HTTP is restricted to loopback hosts.
