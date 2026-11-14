# CareerMatch AI — Offline-first MVP

A free, advertisement-free CV tailoring Progressive Web App built with React, Vite and TypeScript.

## Requirements
- Node.js 20.19+ or 22.12+ (compatible with current Vite versions)
- npm
- VS Code (recommended)

## Run on Windows (PowerShell)
```powershell
cd careerMatch-ai
npm.cmd install
npm.cmd run dev
```
Open the localhost URL printed by Vite.

## Production build
```powershell
npm.cmd run build
npm.cmd run preview
```

See the [controlled public beta deployment plan](./docs/controlled-beta-deployment.md) for HTTPS hosting configuration, production CORS, PWA update headers, release checks, and rollback steps. No deployment has been performed.

## Tests
```powershell
npm.cmd test
```

## Job extraction backend (optional)
The standalone FastAPI service is in [backend/](./backend/). See its [setup and deployment instructions](./backend/README.md) to install and run it locally. Set `VITE_JOB_EXTRACTION_ENDPOINT` in the frontend's `.env.local` to `http://127.0.0.1:8000/api/job-extraction` for local development; production must use HTTPS and an explicitly configured CORS origin allowlist.

## Offline testing
1. Build the app and serve it with `npm.cmd run preview`.
2. Open the app while connected, allowing the service worker to cache the assets.
3. Reload once, then disconnect the internet and reopen the app.
4. Create a profile, paste or import a job description (PDF/DOCX/TXT), analyse it, create a CV and export PDF/DOCX. Job links can be saved offline; online extraction requires a configured backend.

Service workers require HTTPS or localhost. Vite dev mode is not a reliable offline PWA test. A fresh installation requires connectivity or another means of transferring the application assets.

## Features
- Guest-only Career Passport with education, experience, skills, projects and certifications
- IndexedDB autosave using Dexie
- Offline job requirement keyword matching (heuristic, not an ATS score)
- Quick Tailor supports pasted descriptions, saved job links and local PDF/DOCX/TXT text extraction
- Saved job advertisements and pending URLs are stored in IndexedDB and can be selected again later
- Basic evidence-based CV assembly and editing
- Per-CV selection of skills, experience and education, with refresh from the latest Career Passport
- Three preview templates
- Template-aware PDF export with jsPDF and DOCX export with docx; each exporter is loaded on demand
- CV library, local backup and restore, delete local data
- PWA installability and offline app-shell caching
- Responsive desktop and mobile layouts

## Important limitations
- No real Figma file was provided; this UI implements the agreed brand/design prompt rather than a pixel-perfect Figma export.
- No authentication, cloud sync or online AI. URL extraction is optional and uses the separately deployed secure FastAPI service; the browser never fetches third-party job pages directly.
- Local PDF import extracts selectable text only; scanned-image PDFs need OCR and are not processed.
- Offline matching recognises a curated keyword list and exact skill mentions, not full semantic equivalence.
- The CV summary is template-based, not AI-generated; review every statement before use.
- Exports use the selected template's accent and header alignment, but do not reproduce the preview pixel-for-pixel.
- Guest data is stored unencrypted in browser IndexedDB and can be lost if site data is cleared. Downloaded backups and exports are also unencrypted; protect them like other personal documents.
- Browser/PWA offline behaviour and document export must be validated on actual iPhones and budget Android devices.
- The CSS uses system font fallbacks and makes no external font requests.
- The local backup restore function validates basic structure, not a comprehensive schema; do not restore untrusted backup files.

## Next milestones
1. Test and harden iOS/Android offline exports and persistent storage.
2. Add screenshot OCR with a clear offline fallback.
3. Deploy and monitor the optional [secure URL extraction service](./backend/README.md), then add opt-in synchronisation separately.
4. Add OpenAI-backed analysis with source evidence checks and cost controls.
5. Expand accessibility, tests, localisation and deployment.

## Privacy
By default this MVP makes no application API calls and includes no advertising or analytics. If `VITE_JOB_EXTRACTION_ENDPOINT` is configured, only the job URL is sent to that backend for extraction; profile data remains local unless explicitly exported. The endpoint URL is public configuration, not a credential. IndexedDB, backups, and exports are not encrypted by the app.
