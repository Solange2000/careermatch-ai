# Controlled public beta deployment plan

**Status:** preparation only. No hosting resources have been created and no deployment has been run. Real production domains are not yet selected.

## Recommendation

| Component | Recommendation | Cost and caveat |
|---|---|---|
| Static frontend | Cloudflare Pages, Free plan, connected to the repository | Suitable for the Vite `dist` output and managed HTTPS. Verify current quotas and account terms before launch. |
| Extraction API | An already available Python host behind a TLS reverse proxy whose trusted client-proxy IPs can be configured | Use one process/instance for the current in-memory rate limiter. Do not add a paid service just for the beta. |
| Temporary API staging | Render Free Web Service, only if useful for a non-production integration test | Render currently documents Free instances as unsuitable for production; they spin down after inactivity, have ephemeral filesystems, and can be suspended at usage limits. Do not treat this as dependable public-beta hosting. |

If no suitable Python host is already available, deploy the static frontend without `VITE_JOB_EXTRACTION_ENDPOINT` and keep URL extraction disabled. Pasted descriptions, local imports, matching, CV editing, exports, and offline storage remain available. Do not substitute a free API tier with unsuitable reliability or proxy/rate-limit behavior.

The client has no account system. CORS is a browser policy, **not authentication**: scripts and command-line clients can call the public API directly. A small public beta therefore still needs request monitoring and a plan to disable the API if it is abused.

## Audit findings

- `VITE_JOB_EXTRACTION_ENDPOINT` is compiled into the frontend bundle. It must be an HTTPS URL in production and is public configuration, never a secret. Vite also loads `.env.local` during production builds; the Vite production config now clears the endpoint when it is omitted, preventing a local URL from being embedded, and rejects configured non-HTTPS URLs. Omitting it disables online extraction.
- The backend now requires `APP_ENV=production` and explicit `CORS_ALLOWED_ORIGINS` in production. It rejects wildcard, non-HTTPS production origins, and origins containing paths. Development defaults remain limited to localhost.
- Keep CORS origins to the canonical deployed frontend origin(s), without a trailing path or wildcard. Do not allow arbitrary preview domains. If a separate preview is needed, add its exact HTTPS origin deliberately and remove it afterward.
- The backend has no database or persistent file requirement. Its rate limiter and robots cache are in process memory; run one worker and one instance for the beta. Scaling to multiple workers/instances would create independent limits and caches.
- The extraction implementation validates public IPs, pins each resolved IP, revalidates redirects, keeps HTTPX TLS verification enabled, disables inherited proxy settings, limits request/response sizes, redirects and timeouts, applies rate limiting, and checks robots.txt. Deployment must not add an outbound proxy or change these controls.
- The PWA registers with automatic updates and precaches offline assets. `public/_headers` prevents stale HTML/service-worker scripts and gives fingerprinted assets immutable caching. The unused jsPDF HTML-renderer chunks are intentionally not precached; text-based PDF/DOCX export was verified offline.
- A Content Security Policy is not preconfigured because the production API origin is not selected and PDF.js worker behavior must be tested on the chosen host. Add an exact `connect-src` API origin and test PDF import/PWA install before enforcing CSP; do not use a permissive wildcard as a shortcut.
- Career Passport, CVs, and saved jobs are stored in browser IndexedDB without encryption at rest. Downloaded JSON backups, PDFs, and DOCX files are ordinary unencrypted files. Hosting HTTPS protects network traffic, not data on a shared or compromised device.
- Provider logs and backups need their own retention/access controls. The app does not upload the profile or CV; URL extraction sends the job URL to the configured backend.

## Hosting configuration

### Frontend: Cloudflare Pages

Create a Pages project from the repository only after beta approval. Use:

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Root directory | `/` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 22.12 or newer supported Node 22.x |
| Build environment variable | `VITE_JOB_EXTRACTION_ENDPOINT=https://<api-host>/api/job-extraction` |

Set the endpoint in the Pages project’s production build environment, not as a runtime-only secret. A Vite build must be rerun and redeployed after changing this value. The checked-in [.env.production.example](../.env.production.example) is a placeholder only; replace the example host before building. Do not set this endpoint at all when running a frontend-only beta.

For a local production candidate build after selecting the real API host:

```powershell
$env:VITE_JOB_EXTRACTION_ENDPOINT = 'https://<api-host>/api/job-extraction'
npm.cmd run build
```

If the endpoint is omitted, production builds deliberately clear any value inherited from the ignored `.env.local` and leave online extraction disabled. An explicitly configured non-HTTPS production endpoint fails the build.

Cloudflare’s current Vite build settings use `npm run build` and `dist`; Pages Free has published build and asset limits. Confirm the latest [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) and [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) before selecting it.

### API: existing Python host

The host must provide Python 3.12 (prefer the latest supported 3.12 patch), HTTPS termination, environment variables, outbound DNS and HTTPS, a health-check path, and a way to trust only its actual reverse proxy when interpreting forwarded client IPs.

Set these runtime variables in the host’s protected service settings:

```text
APP_ENV=production
CORS_ALLOWED_ORIGINS=https://<canonical-frontend-host>
RATE_LIMIT_PER_MINUTE=30
LOG_LEVEL=INFO
```

Add another exact origin only if the beta intentionally serves the same app at another production domain. Do not put `VITE_` values or provider credentials in backend settings unless the backend actually needs them. Never put secrets in frontend build variables.

For a self-managed service behind a reverse proxy on the same host, run one Uvicorn worker bound to loopback:

```bash
cd backend
python -m pip install -r requirements.txt
APP_ENV=production \
CORS_ALLOWED_ORIGINS=https://<canonical-frontend-host> \
RATE_LIMIT_PER_MINUTE=30 \
LOG_LEVEL=INFO \
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips=127.0.0.1
```

The reverse proxy must overwrite, not append untrusted client-supplied forwarding headers. For Nginx, the relevant directives are:

```nginx
proxy_pass http://127.0.0.1:8000;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
```

Use the host’s TLS certificate automation for the API domain. Do not expose Uvicorn directly to the internet or trust `X-Forwarded-For` from arbitrary clients. Verify the API’s observed client address and rate-limit behavior through the chosen provider’s proxy before beta access.

For a Render **staging-only** service, set the service root directory to `backend`, build command to `pip install -r requirements.txt`, health check path to `/health`, and start command to:

```text
uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1
```

Set the four runtime variables above in Render’s environment settings and set `CORS_ALLOWED_ORIGINS` to the exact Pages origin. Render’s official [FastAPI instructions](https://render.com/docs/deploy-fastapi) use the same host/port pattern. Its current [Free service limitations](https://render.com/docs/free) explicitly say not to use Free instances for production applications; use this only for staging unless the hosting decision changes.

## Exact local preparation and verification commands

From the repository root in Windows PowerShell:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build

Set-Location backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pytest -q
$env:APP_ENV = 'development'
$env:CORS_ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173'
$env:RATE_LIMIT_PER_MINUTE = '30'
$env:LOG_LEVEL = 'INFO'
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

For a local production-mode CORS check, stop the development server and start a fresh process with a real HTTPS frontend origin:

```powershell
$env:APP_ENV = 'production'
$env:CORS_ALLOWED_ORIGINS = 'https://<canonical-frontend-host>'
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
```

The production CORS check intentionally fails at startup if `APP_ENV=production` has no explicit HTTPS origin.

After a future approved deployment, run these smoke checks with real hostnames:

```powershell
curl.exe -fsS https://<api-host>/health
curl.exe -i -X OPTIONS https://<api-host>/api/job-extraction -H "Origin: https://<canonical-frontend-host>" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
curl.exe -i -X OPTIONS https://<api-host>/api/job-extraction -H "Origin: https://unapproved.example" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"
curl.exe -i -X POST https://<api-host>/api/job-extraction -H "Origin: https://<canonical-frontend-host>" -H "Content-Type: application/json" --data-raw '{"url":"https://www.jobopportunitiessa.com/maziv-it-administrator-job-2026-apply-now/"}'
```

Expected: health is successful; the approved origin receives an allow-origin response; the unapproved origin does not; the POST either returns source-derived extraction data or a documented extraction/robots error. Do not interpret CORS failure as protection against direct non-browser API calls.

These are instructions only; none of the hosting or post-deployment commands above has been run.

## Production readiness checklist

- [ ] Confirm a canonical frontend domain and a Python API host; confirm the API host’s outbound-fetch rules, proxy behavior, HTTPS, logs, quotas, and incident contact.
- [ ] Confirm the API host is appropriate for a public beta. Do not use Render Free as production hosting.
- [ ] Set `APP_ENV=production`, the exact HTTPS `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, and `LOG_LEVEL` in the API provider’s service settings.
- [ ] Set `VITE_JOB_EXTRACTION_ENDPOINT` to the API’s HTTPS URL in the frontend production build settings. Confirm it contains no credential.
- [ ] Keep one API worker and one instance until the in-memory rate limiter is replaced by a shared mechanism; do not add one for this beta without a separate design review.
- [ ] Verify the API’s client IP and per-client rate limit through the actual proxy. Confirm proxy-supplied forwarding headers are overwritten or trusted only from known proxy IPs.
- [ ] Run frontend tests, backend tests, and the production build on the release commit.
- [ ] Check health, approved and rejected CORS preflights, one permitted extraction, request rate limiting, and backend logs. Confirm logs contain no job description or sensitive query data.
- [ ] Test installation and updates over HTTPS on current Chrome/Edge and Safari/iOS; check `manifest.webmanifest`, `sw.js` JavaScript MIME type, and service-worker revalidation headers.
- [ ] Install the PWA, save a profile/job/CV, go offline, reload, edit/export, and confirm the local records remain. Reconnect and verify an update does not delete local data.
- [ ] Review backup contents before sharing. Tell beta users that IndexedDB and downloaded files are unencrypted and that clearing browser data can erase records.
- [ ] Publish a privacy notice explaining local storage, the job URL sent to the extraction API, provider log retention, and how to delete local data.
- [ ] Keep a named release artifact and the previous frontend/API revisions available for rollback.

## Rollback plan

1. **Stop exposure first if there is an abuse or security incident.** Disable/roll back the API service at the host, or remove the frontend endpoint setting and rebuild/redeploy the frontend. Manual paste, local import, matching, and offline CV workflows remain available.
2. **Frontend regression:** use the static host’s deployment history to restore the previous successful `dist` deployment. If the endpoint changed, restore the previous build configuration too. The auto-updating service worker will pick up the rolled-back assets when it checks for updates; users may need to reopen the app.
3. **API regression:** restore the previous successful API release, keeping `/api/job-extraction`, request/response shape, HTTPS, and CORS configuration compatible with the currently deployed frontend.
4. **Do not clear user IndexedDB as a rollback step.** The app stores user data in each browser; a static/API rollback does not require deleting it. Any future database schema change must be backward-compatible with the previous frontend before deployment.
5. **Verify after rollback:** health check, approved CORS preflight, frontend load, extraction/manual fallback, and an offline reload. Record the incident, release IDs, affected dates, and whether users should re-export local backups.

## Privacy and beta risks

- IndexedDB is origin-scoped but not encrypted. Anyone with access to the browser profile or same-origin script execution can read it.
- The JSON backup contains the profile, saved CVs, and saved jobs in plain text. PDFs and DOCX exports also contain personal information and are not password-protected by the app. Use a trusted device, protect the OS account, and avoid sending backups through public/shared storage.
- The backend is unauthenticated. It receives a URL, fetches public job-page content, and returns extracted fields; the user’s profile and CV are not sent. CORS does not authenticate callers.
- Rate limiting and robots cache are process-local. Restarts reset them; multiple workers/instances do not share them. Public beta traffic can therefore exceed the intended per-client limit if the deployment scales or client-IP forwarding is incorrect.
- Static-host/API-provider operational logs and any support exports are outside IndexedDB. Configure minimal retention and restrict provider-dashboard access.
- The service intentionally does not bypass login walls, anti-bot controls, robots disallow rules, or paywalls. Some listings will require users to paste text manually.

## Hosting references

- [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Render FastAPI deployment instructions](https://render.com/docs/deploy-fastapi)
- [Render Free service limitations](https://render.com/docs/free)
