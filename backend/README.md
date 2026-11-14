# CareerMatch AI job extraction API

This standalone FastAPI service implements the frontend contract at
`POST /api/job-extraction`:

```json
{"url":"https://public-job-site.example/jobs/role"}
```

Successful responses contain a non-empty `description`, with `title`,
`company`, and `location` included only when present in the page:

```json
{"title":"Data Analyst","company":"Example Co","location":"Cape Town","description":"..."}
```

Missing information is not inferred. JSON-LD `JobPosting` values are preferred;
semantic HTML and explicit job-description selectors are used as fallback.
No AI service or paid API is required.

## Local setup (Windows PowerShell)

Python 3.10 or newer is required.

From the repository root:

```powershell
py -3 -m venv backend\.venv
backend\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements.txt
Copy-Item backend\.env.example backend\.env
python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

The local API is available at `http://127.0.0.1:8000`; the health check is
`/health`. Keep the `.env` file private and configure values for deployment:

- `APP_ENV`: use `production` for a deployed service; production requires explicit HTTPS CORS origins.
- `CORS_ALLOWED_ORIGINS`: comma-separated exact frontend origins (no wildcard).
- `RATE_LIMIT_PER_MINUTE`: per-client in-memory request limit (default `30`).
- `LOG_LEVEL`: Python logging level (default `INFO`).

See the [controlled beta deployment guide](../docs/controlled-beta-deployment.md) for hosting constraints, reverse-proxy requirements, production settings, smoke checks, and rollback steps. Production CORS configuration is validated at startup.

For Vite, add this public endpoint setting to the repository-root `.env.local`:

```text
VITE_JOB_EXTRACTION_ENDPOINT=http://127.0.0.1:8000/api/job-extraction
```

Restart Vite after changing environment variables. Production frontend and API
must use HTTPS, and production `CORS_ALLOWED_ORIGINS` must contain only the
deployed frontend origins.

## Tests

```powershell
python -m pytest backend -q
npm.cmd test
npm.cmd run build
```

## Security notes

The service accepts only HTTP(S) on standard ports, rejects non-public
destinations, resolves and pins the destination IP per request, and repeats
validation for every redirect. It disables environment proxy inheritance and
limits redirects, time, request size, response size, content type, and request
rate. It checks each origin's `robots.txt` policy and fails closed if access is
disallowed or the policy cannot be checked. It never logs fetched descriptions
or query strings.

The rate limiter is process-local; use an API gateway or shared rate-limit
store for multi-worker/public deployments. Deploy behind a TLS-terminating
reverse proxy with outbound network controls. Extraction does not execute
scripts or bypass sign-in, paywalls, anti-bot controls, or site restrictions.
Some sites may block automated access or render their job text only in scripts;
these cases return an explicit error and the frontend's offline/manual workflow
remains available.
