from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import os
import re
import socket
import time
import traceback
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import SplitResult, urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse

load_dotenv(Path(__file__).with_name(".env"))

MAX_REQUEST_BYTES = 16 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_DESCRIPTION_CHARS = 50_000
MAX_REDIRECTS = 5
FETCH_TIMEOUT_SECONDS = 7.0
DNS_TIMEOUT_SECONDS = 2.0
EXTRACTION_TIMEOUT_SECONDS = 18.0
ROBOTS_CACHE_SECONDS = 600.0
MAX_ROBOTS_CACHE_ENTRIES = 1024
RATE_WINDOW_SECONDS = 60.0
MAX_TRACKED_CLIENTS = 10_000
RATE_LIMIT = max(1, int(os.getenv("RATE_LIMIT_PER_MINUTE", "30")))
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()


def _configured_cors_origins(environment: str, configured: str | None) -> list[str]:
    if environment not in {"development", "production"}:
        raise RuntimeError("APP_ENV must be 'development' or 'production'.")
    if environment == "production" and not configured:
        raise RuntimeError("CORS_ALLOWED_ORIGINS must be explicitly configured in production.")

    raw_origins = configured if configured is not None else "http://localhost:5173,http://127.0.0.1:5173"
    origins: list[str] = []
    for candidate in raw_origins.split(","):
        value = candidate.strip()
        if not value:
            continue
        if value == "*":
            raise RuntimeError("CORS_ALLOWED_ORIGINS must list explicit frontend origins.")
        try:
            parsed = urlsplit(value)
            hostname = parsed.hostname
            port = parsed.port
        except ValueError as error:
            raise RuntimeError("CORS_ALLOWED_ORIGINS contains an invalid origin.") from error
        scheme = parsed.scheme.lower()
        if (
            not hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise RuntimeError("CORS_ALLOWED_ORIGINS entries must be exact origins without paths.")
        if environment == "production" and scheme != "https":
            raise RuntimeError("Production CORS origins must use HTTPS.")
        if scheme != "https" and not (
            scheme == "http" and hostname.lower() in {"localhost", "127.0.0.1", "::1"}
        ):
            raise RuntimeError("HTTP CORS origins are allowed only for local development.")

        normalized_host = hostname.lower()
        if ":" in normalized_host:
            normalized_host = f"[{normalized_host}]"
        default_port = 443 if scheme == "https" else 80
        normalized_port = f":{port}" if port is not None and port != default_port else ""
        origin = f"{scheme}://{normalized_host}{normalized_port}"
        if origin not in origins:
            origins.append(origin)

    if not origins:
        raise RuntimeError("CORS_ALLOWED_ORIGINS must list at least one frontend origin.")
    return origins


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return json.dumps(
            {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
                "level": record.levelname.lower(),
                "message": record.getMessage(),
                **getattr(record, "fields", {}),
            },
            separators=(",", ":"),
        )


logger = logging.getLogger("job_extractor")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
logger.propagate = False
robots_cache: dict[str, tuple[float, RobotFileParser]] = {}


@dataclass
class ExtractionError(Exception):
    status_code: int
    code: str
    message: str


class ExtractionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    url: str = Field(min_length=8, max_length=2048)


class ExtractionResponse(BaseModel):
    title: str | None = None
    company: str | None = None
    location: str | None = None
    description: str


class RequestSizeLimitMiddleware:
    def __init__(self, app: Any, limit: int = MAX_REQUEST_BYTES) -> None:
        self.app = app
        self.limit = limit

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > self.limit:
                body = b'{"detail":{"code":"request_too_large","message":"Request body exceeds the allowed size."}}'
                await send(
                    {
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode("ascii")),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
            chunks.append(chunk)
            if not message.get("more_body", False):
                break

        delivered = False

        async def replay_body() -> dict[str, Any]:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, replay_body, send)


class RequestRateLimitMiddleware:
    def __init__(self, app: Any) -> None:
        self.app = app
        self.requests: defaultdict[str, deque[float]] = defaultdict(deque)

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope.get("method") != "POST" or scope.get("path") != "/api/job-extraction":
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        key = client[0] if client else "unknown"
        now = time.monotonic()
        if key not in self.requests and len(self.requests) >= MAX_TRACKED_CLIENTS:
            stale = [
                ip
                for ip, values in self.requests.items()
                if not values or now - values[-1] >= RATE_WINDOW_SECONDS
            ]
            for ip in stale:
                self.requests.pop(ip, None)
            if len(self.requests) >= MAX_TRACKED_CLIENTS:
                body = b'{"detail":{"code":"rate_limited","message":"The extraction service is temporarily rate-limited."}}'
                await send(
                    {
                        "type": "http.response.start",
                        "status": 429,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode("ascii")),
                            (b"retry-after", b"60"),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
        timestamps = self.requests[key]
        while timestamps and now - timestamps[0] >= RATE_WINDOW_SECONDS:
            timestamps.popleft()
        if len(timestamps) >= RATE_LIMIT:
            body = b'{"detail":{"code":"rate_limited","message":"Too many extraction requests. Try again later."}}'
            await send(
                {
                    "type": "http.response.start",
                    "status": 429,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode("ascii")),
                        (b"retry-after", b"60"),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        timestamps.append(now)
        await self.app(scope, receive, send)


app = FastAPI(title="CareerMatch AI Job Extraction", version="1.0.0")
app.add_middleware(RequestRateLimitMiddleware)
app.add_middleware(RequestSizeLimitMiddleware)
allowed_origins = _configured_cors_origins(APP_ENV, os.getenv("CORS_ALLOWED_ORIGINS"))
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def log_request(request: Request, call_next: Any) -> Any:
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    try:
        response = await call_next(request)
    except Exception as error:
        logger.error(
            "request_failed",
            extra={
                "fields": {
                    "request_id": request_id,
                    "path": request.url.path,
                    "error_type": type(error).__name__,
                }
            },
        )
        raise
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request_complete",
        extra={
            "fields": {
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
            }
        },
    )
    return response


@app.exception_handler(ExtractionError)
async def handle_extraction_error(_: Request, error: ExtractionError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"detail": {"code": error.code, "message": error.message}},
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/api/job-extraction",
    response_model=ExtractionResponse,
    response_model_exclude_none=True,
)
async def extract_job(request: ExtractionRequest, http_request: Request) -> ExtractionResponse:
    stage = "url_validation"
    try:
        validate_job_url(request.url)
        stage = "page_retrieval"
        html = await asyncio.wait_for(retrieve_job_page(request.url), timeout=EXTRACTION_TIMEOUT_SECONDS)
        stage = "html_extraction"
        result = extract_job_fields(html)
        if not result.get("description", "").strip():
            raise ExtractionError(
                422,
                "extraction_failed",
                "No readable job description was found on this page.",
            )
        logger.info(
            "job_extracted",
            extra={
                "fields": {
                    "request_id": http_request.state.request_id,
                    "host": urlsplit(request.url).hostname,
                    "has_title": bool(result.get("title")),
                    "has_company": bool(result.get("company")),
                    "has_location": bool(result.get("location")),
                }
            },
        )
        return ExtractionResponse(**result)
    except asyncio.TimeoutError as error:
        raise ExtractionError(504, "upstream_timeout", "Retrieving the job page timed out.") from error
    except ExtractionError:
        raise
    except Exception as error:
        fields: dict[str, Any] = {
            "request_id": http_request.state.request_id,
            "host": urlsplit(request.url).hostname,
            "error_type": type(error).__name__,
            "error_module": type(error).__module__,
            "stage": stage,
        }
        if isinstance(error, AttributeError) and isinstance(error.name, str):
            fields["missing_attribute"] = error.name
        if logger.isEnabledFor(logging.DEBUG):
            fields["traceback"] = [
                {
                    "file": Path(frame.filename).name,
                    "line": frame.lineno,
                    "function": frame.name,
                }
                for frame in traceback.extract_tb(error.__traceback__)
            ]
        logger.error(
            "extraction_unexpected_error",
            extra={"fields": fields},
        )
        raise HTTPException(
            status_code=502,
            detail={"code": "upstream_error", "message": "The job page could not be retrieved."},
        ) from error


async def retrieve_job_page(url: str) -> str:
    await ensure_robots_allows(url)
    return await fetch_public_page(url)


async def ensure_robots_allows(url: str) -> None:
    parsed = validate_job_url(url)
    origin = urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))
    cached = robots_cache.get(origin)
    now = time.monotonic()
    if cached and now - cached[0] < ROBOTS_CACHE_SECONDS:
        parser = cached[1]
    else:
        robots_url = urlunsplit((parsed.scheme, parsed.netloc, "/robots.txt", "", ""))
        parser = RobotFileParser()
        try:
            robots_text = await fetch_public_page(robots_url, check_redirect_robots=False)
        except ExtractionError as error:
            if error.code != "page_not_found":
                raise ExtractionError(
                    403,
                    "robots_unavailable",
                    "The website's crawling policy could not be checked.",
                ) from error
            robots_text = ""
        parser.parse(robots_text.splitlines())
        if len(robots_cache) >= MAX_ROBOTS_CACHE_ENTRIES:
            oldest = min(robots_cache, key=lambda key: robots_cache[key][0])
            robots_cache.pop(oldest, None)
        robots_cache[origin] = (now, parser)
    if not parser.can_fetch("CareerMatchJobExtractor", url):
        raise ExtractionError(
            403,
            "robots_disallowed",
            "The website's crawling policy does not allow this page to be retrieved.",
        )


def validate_job_url(value: str) -> SplitResult:
    if len(value) > 2048 or any(ord(char) < 32 or ord(char) == 127 for char in value) or "\\" in value:
        raise ExtractionError(422, "invalid_url", "Provide a valid public HTTP or HTTPS job URL.")
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as error:
        raise ExtractionError(422, "invalid_url", "Provide a valid public HTTP or HTTPS job URL.") from error

    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise ExtractionError(422, "invalid_url", "Provide a valid public HTTP or HTTPS job URL.")
    expected_port = 443 if parsed.scheme.lower() == "https" else 80
    if port not in (None, expected_port):
        raise ExtractionError(422, "unsupported_port", "Only standard HTTP and HTTPS ports are supported.")

    try:
        ascii_host = hostname.rstrip(".").encode("idna").decode("ascii").lower()
    except UnicodeError as error:
        raise ExtractionError(422, "invalid_host", "Provide a valid public hostname.") from error
    if not ascii_host or ascii_host.endswith((".localhost", ".local", ".internal")):
        raise ExtractionError(403, "blocked_destination", "Private and reserved network destinations are not allowed.")
    try:
        address = ipaddress.ip_address(ascii_host)
    except ValueError:
        if not re.fullmatch(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*", ascii_host):
            raise ExtractionError(422, "invalid_host", "Provide a valid public hostname.")
        return parsed
    if not _is_public_address(address):
        raise ExtractionError(403, "blocked_destination", "Private and reserved network destinations are not allowed.")
    return parsed


def _is_public_address(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped:
            return _is_public_address(address.ipv4_mapped)
        if address.sixtofour or address.teredo:
            return False
    return address.is_global and not (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


async def _resolve_public_ips(hostname: str, port: int) -> list[str]:
    try:
        records = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(hostname, port, type=socket.SOCK_STREAM),
            timeout=DNS_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as error:
        raise ExtractionError(504, "upstream_timeout", "Resolving the job page host timed out.") from error
    except (OSError, socket.gaierror) as error:
        raise ExtractionError(404, "host_unreachable", "The job page host could not be reached.") from error
    addresses = list(dict.fromkeys(record[4][0] for record in records))
    if not addresses:
        raise ExtractionError(404, "host_unreachable", "The job page host could not be reached.")
    try:
        parsed_addresses = [ipaddress.ip_address(address.split("%", 1)[0]) for address in addresses]
    except ValueError as error:
        raise ExtractionError(403, "blocked_destination", "The host resolved to an invalid network address.") from error
    if any(not _is_public_address(address) for address in parsed_addresses):
        raise ExtractionError(403, "blocked_destination", "Private and reserved network destinations are not allowed.")
    return addresses


def _url_for_ip(parsed: SplitResult, address: str) -> str:
    host = f"[{address}]" if ":" in address else address
    return urlunsplit((parsed.scheme, host, parsed.path or "/", parsed.query, ""))


async def fetch_public_page(
    url: str,
    transport: httpx.AsyncBaseTransport | None = None,
    check_redirect_robots: bool = True,
) -> str:
    current_url = url
    timeout = httpx.Timeout(FETCH_TIMEOUT_SECONDS, connect=5.0)
    async with httpx.AsyncClient(
        timeout=timeout,
        follow_redirects=False,
        trust_env=False,
        transport=transport,
        headers={
            "User-Agent": "CareerMatchJobExtractor/1.0 (+public job page extraction)",
            "Accept-Encoding": "identity",
        },
    ) as client:
        for redirect_count in range(MAX_REDIRECTS + 1):
            parsed = validate_job_url(current_url)
            hostname = parsed.hostname or ""
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            addresses = await _resolve_public_ips(hostname, port)
            ip_url = _url_for_ip(parsed, addresses[0])
            host_header = f"[{hostname}]" if ":" in hostname else hostname
            headers = {"Host": host_header}
            if port != (443 if parsed.scheme == "https" else 80):
                headers["Host"] = f"{host_header}:{port}"
            request = client.build_request("GET", ip_url, headers=headers)
            if parsed.scheme == "https":
                request.extensions["sni_hostname"] = hostname
            try:
                async with client.stream(request.method, request.url, headers=headers, extensions=request.extensions) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location or redirect_count >= MAX_REDIRECTS:
                            raise ExtractionError(404, "redirect_limit", "The page redirected too many times.")
                        current_url = urljoin(current_url, location)
                        validate_job_url(current_url)
                        if check_redirect_robots:
                            await ensure_robots_allows(current_url)
                        continue
                    if response.status_code in {401, 403}:
                        raise ExtractionError(403, "access_denied", "The job page requires access the service cannot provide.")
                    if response.status_code in {404, 410}:
                        raise ExtractionError(404, "page_not_found", "The job page is unavailable.")
                    if response.status_code == 429:
                        raise ExtractionError(429, "upstream_rate_limited", "The job website is temporarily rate-limiting requests.")
                    if response.status_code >= 500:
                        raise ExtractionError(502, "upstream_error", "The job website could not complete the request.")
                    if not 200 <= response.status_code < 300:
                        raise ExtractionError(415, "unsupported_page", "The job website does not allow this page to be retrieved.")

                    media_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                    if media_type not in {"text/html", "application/xhtml+xml", "text/plain"}:
                        raise ExtractionError(415, "unsupported_content_type", "The page is not an HTML or text job advertisement.")
                    content_encoding = response.headers.get("content-encoding", "identity").lower()
                    if content_encoding not in {"", "identity"}:
                        raise ExtractionError(415, "unsupported_content_encoding", "The page uses an unsupported content encoding.")
                    length_header = response.headers.get("content-length")
                    if length_header:
                        try:
                            if int(length_header) > MAX_RESPONSE_BYTES:
                                raise ExtractionError(413, "page_too_large", "The job page exceeds the allowed size.")
                        except ValueError:
                            pass
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > MAX_RESPONSE_BYTES:
                            raise ExtractionError(413, "page_too_large", "The job page exceeds the allowed size.")
                    encoding = _response_encoding(response.headers.get("content-type", ""), bytes(content))
                    try:
                        return bytes(content).decode(encoding, errors="replace")
                    except LookupError:
                        return bytes(content).decode("utf-8", errors="replace")
            except httpx.TimeoutException as error:
                raise ExtractionError(504, "upstream_timeout", "Retrieving the job page timed out.") from error
            except httpx.RequestError as error:
                raise ExtractionError(404, "host_unreachable", "The job page could not be reached.") from error
    raise ExtractionError(404, "redirect_limit", "The page redirected too many times.")


def _response_encoding(content_type: str, content: bytes) -> str:
    declared = re.search(r"\bcharset\s*=\s*[\"']?\s*([\w.-]+)", content_type, re.IGNORECASE)
    if declared:
        return declared.group(1)
    meta = re.search(
        rb"<meta\b[^>]*\bcharset\s*=\s*[\"']?\s*([\w.-]+)",
        content[:4096],
        re.IGNORECASE,
    )
    if not meta:
        meta = re.search(
            rb"<meta\b[^>]*\bcontent\s*=\s*[\"'][^\"']*charset\s*=\s*([\w.-]+)",
            content[:4096],
            re.IGNORECASE,
        )
    return meta.group(1).decode("ascii") if meta else "utf-8"


def _plain_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    soup = BeautifulSoup(unescape(value), "html.parser")
    return re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()


def _objects(value: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(value, dict):
        item_type = value.get("@type", [])
        if isinstance(item_type, str):
            item_type = [item_type]
        if any(isinstance(entry, str) and entry.rsplit("/", 1)[-1] == "JobPosting" for entry in item_type):
            found.append(value)
        for child in value.values():
            found.extend(_objects(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(_objects(child))
    return found


def _objects_of_type(value: Any, requested_type: str) -> list[dict[str, Any]]:
    if isinstance(value, dict):
        item_type = value.get("@type", [])
        if isinstance(item_type, str):
            item_type = [item_type]
        found = [
            value
        ] if any(
            isinstance(entry, str) and entry.rsplit("/", 1)[-1] == requested_type
            for entry in item_type
        ) else []
        for child in value.values():
            found.extend(_objects_of_type(child, requested_type))
        return found
    if isinstance(value, list):
        return [
            item
            for child in value
            for item in _objects_of_type(child, requested_type)
        ]
    return []


def _first_text(*values: Any) -> str | None:
    for value in values:
        text = _plain_text(value)
        if text:
            return text
    return None


def _organization_name(value: Any) -> str | None:
    if isinstance(value, list):
        return _first_text(*[_organization_name(item) for item in value])
    if isinstance(value, dict):
        return _first_text(value.get("name"))
    return _first_text(value)


def _location_text(value: Any) -> str | None:
    if isinstance(value, list):
        return _first_text(*[_location_text(item) for item in value])
    if not isinstance(value, dict):
        return _first_text(value)
    address = value.get("address", value)
    if isinstance(address, list):
        return _first_text(*[_location_text(item) for item in address])
    if not isinstance(address, dict):
        return _first_text(address)
    parts = []
    for key in ("addressLocality", "addressRegion", "postalCode", "addressCountry"):
        part = address.get(key)
        if isinstance(part, dict):
            part = part.get("name") or part.get("value")
        parts.append(_plain_text(part))
    joined = ", ".join(part for part in parts if part)
    return joined or _first_text(value.get("name"))


def _select_text(soup: BeautifulSoup, selectors: list[str]) -> str | None:
    for selector in selectors:
        element = soup.select_one(selector)
        if element:
            text = _plain_text(element.get("content") or element.get_text(" ", strip=True))
            if text:
                return text
    return None


def _job_detail_value(soup: BeautifulSoup, labels: set[str]) -> str | None:
    for row in soup.select("tr"):
        cells = row.find_all(["th", "td"], recursive=False)
        if len(cells) < 2:
            continue
        label = _plain_text(cells[0].get_text(" ", strip=True)).rstrip(":").casefold()
        if label in labels:
            value = _plain_text(cells[1].get_text(" ", strip=True))
            if value:
                return value
    return None


def _clean_title(value: Any) -> str | None:
    title = _first_text(value)
    if not title or "\ufffd" in title:
        return None
    title = re.sub(r"\s+", " ", title).strip(" \t\r\n-–—|:")
    return title or None


def extract_job_fields(html: str) -> dict[str, str | None]:
    soup = BeautifulSoup(html, "html.parser")
    structured: dict[str, Any] = {}
    article: dict[str, Any] = {}
    for script in soup.select('script[type="application/ld+json"]'):
        try:
            data = json.loads(script.string or script.get_text())
            articles = _objects_of_type(data, "Article")
            if articles and not article:
                article = articles[0]
            for posting in _objects(data):
                if not structured:
                    structured = posting
                if _plain_text(posting.get("description")):
                    structured = posting
                    break
        except (json.JSONDecodeError, TypeError, ValueError):
            continue

    detail_title = _job_detail_value(soup, {"job title", "position"})
    title = _clean_title(structured.get("title"))
    if not title:
        title = _clean_title(
            detail_title
            or article.get("headline")
            or article.get("name")
        )
    if not title:
        title = _clean_title(
            _select_text(soup, ['[itemprop="title"]', "main h1", "article h1", "h1"])
        )
    company = _organization_name(structured.get("hiringOrganization"))
    if not company:
        company = _job_detail_value(soup, {"company", "employer"})
    location = _location_text(structured.get("jobLocation"))
    if not location:
        location = _job_detail_value(soup, {"location", "job location"})
    description = _plain_text(structured.get("description"))

    if not description:
        article_body = article.get("articleBody")
        if isinstance(article_body, str) and (structured or detail_title):
            description = _plain_text(
                re.sub(
                    r"\bExplore More Job Opportunities\b",
                    " ",
                    article_body,
                    flags=re.IGNORECASE,
                )
            )
    if not company:
        company = _select_text(
            soup,
            [
                '[itemprop="hiringOrganization"] [itemprop="name"]',
                '[itemprop="hiringOrganization"]',
                '[itemprop="name"][data-company]',
                "[data-company-name]",
                ".company-name",
                ".employer-name",
                ".job-company",
            ],
        )
    if not location:
        location = _select_text(
            soup,
            [
                '[itemprop="jobLocation"]',
                '[itemprop="addressLocality"]',
                "[data-job-location]",
                ".job-location",
                ".location",
            ],
        )
    if not description:
        description = _select_text(
            soup,
            [
                '[itemprop="description"]',
                "[data-job-description]",
                ".job-description",
                "#job-description",
                ".job-details",
            ],
        )
        if not description:
            broad_candidate = _select_text(soup, ["article", "main"])
            job_signals = (
                "responsibilities",
                "qualifications",
                "requirements",
                "job description",
                "what you'll do",
                "what you will do",
                "what we're looking for",
                "duties",
            )
            if broad_candidate and len(broad_candidate) >= 160 and any(
                signal in broad_candidate.casefold() for signal in job_signals
            ):
                description = broad_candidate

    if description:
        description = description[:MAX_DESCRIPTION_CHARS]
    return {
        "title": title,
        "company": company,
        "location": location,
        "description": description or "",
    }
