# Secure job URL extraction backend plan

## Status

The PWA saves job URLs and supports manual description entry while offline. It does not retrieve third-party pages from the browser. The optional FastAPI backend implements online extraction at `VITE_JOB_EXTRACTION_ENDPOINT`; this is a public endpoint setting, not a secret or API key. Production deployments must use HTTPS.

Implementation is now available in [`backend/`](../backend/). The API supports the contract below and adds an optional source-derived `location` field; see [backend setup and deployment](../backend/README.md).

## Proposed endpoint

`POST /api/job-extraction`

Request:

```json
{ "url": "https://public-job-site.example/role" }
```

Successful response (only when readable job text was actually extracted):

```json
{
  "title": "Extracted title, when available",
  "company": "Extracted company, when available",
  "location": "Extracted location, when available",
  "description": "Extracted job description"
}
```

The `description` must contain non-empty source text. Missing title or company should remain absent rather than be inferred. Use explicit HTTP errors for unsupported URLs, blocked or authenticated pages, rate limits, and extraction failures. Never return a success-shaped empty response.

## Security and reliability requirements

- Accept only HTTP(S) URLs and validate them again on the server.
- Mitigate SSRF: allow only public destinations, block loopback/private/link-local/reserved addresses, resolve and validate DNS on connection, and repeat validation after every redirect.
- Apply strict redirect, response-size, content-type, and timeout limits.
- Restrict outbound access to supported public job sites where feasible. Respect site terms and access controls; do not bypass authentication, anti-bot controls, paywalls, or robots restrictions.
- Parse only server-fetched HTML/text. Do not execute page scripts or accept arbitrary callback/redirect destinations.
- Expose the endpoint over HTTPS, apply per-origin CORS allowlisting, rate limits, request validation, and abuse monitoring. Add authentication or quotas if public exposure requires it.
- Keep provider credentials and any third-party API keys on the server. Never place them in `VITE_*` variables or the client bundle.
- Minimise logging and retention: avoid recording full job descriptions or sensitive query parameters.
- Return source-derived text only. If extraction is blocked or uncertain, return an explicit failure so the UI can retain the URL and ask the user to paste text.

## Implementation and verification

1. Implemented the FastAPI endpoint contract, redirect-aware SSRF protections, HTML/JSON-LD extraction, and explicit error mapping.
2. Automated backend tests cover private destinations, redirects, request limits, extraction successes, and extraction failures.
3. Deploy behind HTTPS with restrictive CORS and rate limits; set `VITE_JOB_EXTRACTION_ENDPOINT` at build time.
4. Verify the PWA reports extraction errors accurately and continues to save URLs and generate CVs from manual or previously saved descriptions while offline.
