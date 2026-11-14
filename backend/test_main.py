import ipaddress
import json
import asyncio
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

import main


client = TestClient(main.app)


def test_validate_job_url_rejects_private_hosts_and_nonstandard_ports() -> None:
    for url in (
        "http://127.0.0.1/job",
        "http://[::1]/job",
        "http://169.254.169.254/latest/meta-data",
        "http://printer.local/job",
        "https://jobs.example:8443/role",
        "file:///etc/passwd",
        "https://user:pass@jobs.example/role",
    ):
        with pytest.raises(main.ExtractionError):
            main.validate_job_url(url)


def test_public_domain_url_is_accepted() -> None:
    parsed = main.validate_job_url("https://jobs.example/role")
    assert parsed.hostname == "jobs.example"


def test_private_and_mapped_addresses_are_not_public() -> None:
    for value in (
        "10.0.0.1",
        "192.168.1.1",
        "169.254.1.2",
        "::ffff:127.0.0.1",
        "2002:0a01:0101::1",
    ):
        assert not main._is_public_address(ipaddress.ip_address(value))


def test_dns_resolution_rejects_mixed_public_and_private_answers(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeLoop:
        async def getaddrinfo(self, *_: object, **__: object) -> list[tuple]:
            return [
                (2, 1, 6, "", ("93.184.216.34", 443)),
                (2, 1, 6, "", ("10.0.0.5", 443)),
            ]

    monkeypatch.setattr(asyncio, "get_running_loop", lambda: FakeLoop())
    with pytest.raises(main.ExtractionError) as error:
        asyncio.run(main._resolve_public_ips("jobs.example", 443))
    assert error.value.status_code == 403


def test_dns_resolution_timeout_is_reported_as_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeLoop:
        async def getaddrinfo(self, *_: object, **__: object) -> list[tuple]:
            await asyncio.sleep(0.02)
            return []

    monkeypatch.setattr(asyncio, "get_running_loop", lambda: FakeLoop())
    monkeypatch.setattr(main, "DNS_TIMEOUT_SECONDS", 0.001)
    with pytest.raises(main.ExtractionError) as error:
        asyncio.run(main._resolve_public_ips("jobs.example", 443))
    assert error.value.status_code == 504


def test_structured_job_posting_extracts_only_source_values() -> None:
    posting = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Data Analyst",
        "hiringOrganization": {"@type": "Organization", "name": "Example Co"},
        "jobLocation": {
            "@type": "Place",
            "address": {"addressLocality": "Cape Town", "addressCountry": "ZA"},
        },
        "description": "<p>Prepare weekly reports.</p><ul><li>Use SQL</li></ul>",
    }
    html = f'<script type="application/ld+json">{json.dumps({"@graph": [posting]})}</script>'
    assert main.extract_job_fields(html) == {
        "title": "Data Analyst",
        "company": "Example Co",
        "location": "Cape Town, ZA",
        "description": "Prepare weekly reports. Use SQL",
    }


def test_html_fallback_extracts_job_fields_and_ignores_generic_pages() -> None:
    html = """
    <main>
      <h1>Support Engineer</h1>
      <span class="company-name">Example Ltd</span>
      <span class="job-location">Remote, ZA</span>
      <section class="job-description"><p>Resolve customer issues and maintain documentation.</p></section>
    </main>
    """
    result = main.extract_job_fields(html)
    assert result["title"] == "Support Engineer"
    assert result["company"] == "Example Ltd"
    assert result["location"] == "Remote, ZA"
    assert "Resolve customer issues" in result["description"]
    assert main.extract_job_fields("<html><main>Welcome to our website</main></html>")["description"] == ""


def test_article_metadata_extracts_clean_job_details_and_article_body() -> None:
    article = {
        "@type": "Article",
        "headline": "MAZIV IT Administrator Job 2026 – Apply Now",
        "articleBody": (
            "<h2>IT Administrator</h2><p>MAZIV is hiring in Durban North.</p>"
            "<p>Explore More Job Opportunities</p><p>Use SQL to support systems.</p>"
        ),
    }
    html = f"""
    <h1>MAZIV IT Administrator Job 2026 \ufffd Apply Now</h1>
    <script type="application/ld+json">{json.dumps(article)}</script>
    <article>
      <table>
        <tr><th>Job Title</th><td>IT Administrator</td></tr>
        <tr><th>Location</th><td>Durban North, KwaZulu-Natal</td></tr>
        <tr><th>Company</th><td>MAZIV</td></tr>
      </table>
      <p>Unrelated related-article text</p>
    </article>
    """

    result = main.extract_job_fields(html)

    assert result == {
        "title": "IT Administrator",
        "company": "MAZIV",
        "location": "Durban North, KwaZulu-Natal",
        "description": "IT Administrator MAZIV is hiring in Durban North. Use SQL to support systems.",
    }
    generic_article = """
    <script type="application/ld+json">
    {"@type":"Article","headline":"Company News","articleBody":"An unrelated update."}
    </script>
    """
    assert main.extract_job_fields(generic_article)["description"] == ""


def test_endpoint_returns_contract_and_optional_location(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fetched(_: str, **__: object) -> str:
        return """
        <script type="application/ld+json">
        {"@type":"JobPosting","title":"Analyst","hiringOrganization":{"name":"Example"},
        "jobLocation":{"address":{"addressLocality":"Durban"}},
        "description":"Analyze reports and share findings."}
        </script>
        """

    monkeypatch.setattr(main, "fetch_public_page", fetched)
    response = client.post("/api/job-extraction", json={"url": "https://jobs.example/analyst"})
    assert response.status_code == 200
    assert response.json() == {
        "title": "Analyst",
        "company": "Example",
        "location": "Durban",
        "description": "Analyze reports and share findings.",
    }


def test_endpoint_fails_instead_of_returning_empty_success(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fetched(_: str, **__: object) -> str:
        return "<html><body>Nothing job-related here.</body></html>"

    monkeypatch.setattr(main, "fetch_public_page", fetched)
    response = client.post("/api/job-extraction", json={"url": "https://jobs.example/unknown"})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "extraction_failed"


def test_unexpected_attribute_error_logs_safe_debug_traceback(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    async def fetched(_: str) -> str:
        return "<main>Job listing</main>"

    def fail(_: str) -> dict[str, str | None]:
        error = AttributeError("private-token=do-not-log")
        error.name = "encode"
        raise error

    monkeypatch.setattr(main, "retrieve_job_page", fetched)
    monkeypatch.setattr(main, "extract_job_fields", fail)
    monkeypatch.setattr(main.logger, "propagate", True)
    with caplog.at_level(logging.DEBUG, logger="job_extractor"):
        response = client.post(
            "/api/job-extraction", json={"url": "https://jobs.example/analyst"}
        )

    assert response.status_code == 502
    record = next(
        entry for entry in caplog.records
        if entry.getMessage() == "extraction_unexpected_error"
    )
    assert record.fields["stage"] == "html_extraction"
    assert record.fields["request_id"]
    assert record.fields["missing_attribute"] == "encode"
    assert any(
        frame["file"] == "main.py" and frame["function"] == "extract_job"
        for frame in record.fields["traceback"]
    )
    assert "private-token" not in json.dumps(record.fields)


def test_robots_policy_blocks_disallowed_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fetched(_: str, **__: object) -> str:
        return "User-agent: CareerMatchJobExtractor\nDisallow: /private"

    async def run() -> None:
        monkeypatch.setattr(main, "fetch_public_page", fetched)
        main.robots_cache.pop("https://policy.example", None)
        with pytest.raises(main.ExtractionError) as error:
            await main.ensure_robots_allows("https://policy.example/private/role")
        assert error.value.status_code == 403
        assert error.value.code == "robots_disallowed"

    asyncio.run(run())


def test_configured_frontend_origin_passes_cors_preflight() -> None:
    response = client.options(
        "/api/job-extraction",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_production_cors_requires_explicit_https_origins() -> None:
    with pytest.raises(RuntimeError, match="explicitly configured"):
        main._configured_cors_origins("production", None)
    with pytest.raises(RuntimeError, match="explicit frontend origins"):
        main._configured_cors_origins("production", "*")
    with pytest.raises(RuntimeError, match="must use HTTPS"):
        main._configured_cors_origins("production", "http://careermatch.example")
    assert main._configured_cors_origins(
        "production", "https://careermatch.example, https://careermatch.example/"
    ) == ["https://careermatch.example"]


def test_development_cors_defaults_to_local_frontend_only() -> None:
    assert main._configured_cors_origins("development", None) == [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    with pytest.raises(RuntimeError, match="only for local development"):
        main._configured_cors_origins("development", "http://careermatch.example")


def test_rate_limit_returns_429(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fetched(_: str, **__: object) -> str:
        return '<div class="job-description">Prepare weekly reports.</div>'

    monkeypatch.setattr(main, "fetch_public_page", fetched)
    monkeypatch.setattr(main, "RATE_LIMIT", 1)
    limited_client = TestClient(main.app, client=("198.51.100.9", 4321))
    payload = {"url": "https://jobs.example/analyst"}
    assert limited_client.post("/api/job-extraction", json=payload).status_code == 200
    response = limited_client.post("/api/job-extraction", json=payload)
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "rate_limited"


def test_redirect_to_private_address_is_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    async def resolve(hostname: str, port: int) -> list[str]:
        if hostname == "jobs.example":
            return ["93.184.216.34"]
        raise main.ExtractionError(403, "blocked_destination", "blocked")

    async def run() -> None:
        monkeypatch.setattr(main, "_resolve_public_ips", resolve)
        transport = httpx.MockTransport(
            lambda _: httpx.Response(302, headers={"Location": "http://127.0.0.1/admin"})
        )
        with pytest.raises(main.ExtractionError) as error:
            await main.fetch_public_page("https://jobs.example/role", transport=transport)
        assert error.value.status_code == 403

    asyncio.run(run())


def test_redirect_target_must_allow_crawling(monkeypatch: pytest.MonkeyPatch) -> None:
    async def resolve(_: str, __: int) -> list[str]:
        return ["93.184.216.34"]

    async def disallow(url: str) -> None:
        if "other.example" in url:
            raise main.ExtractionError(403, "robots_disallowed", "blocked")

    async def run() -> None:
        monkeypatch.setattr(main, "_resolve_public_ips", resolve)
        monkeypatch.setattr(main, "ensure_robots_allows", disallow)
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(302, headers={"Location": "https://other.example/private"})

        with pytest.raises(main.ExtractionError) as error:
            await main.fetch_public_page(
                "https://jobs.example/role", transport=httpx.MockTransport(respond)
            )
        assert error.value.code == "robots_disallowed"
        assert len(requests) == 1

    asyncio.run(run())


def test_fetch_pins_public_ip_while_preserving_host_and_tls_name(monkeypatch: pytest.MonkeyPatch) -> None:
    async def resolve(_: str, __: int) -> list[str]:
        return ["93.184.216.34"]

    async def run() -> None:
        monkeypatch.setattr(main, "_resolve_public_ips", resolve)
        requests: list[httpx.Request] = []

        def respond(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                200,
                headers={"Content-Type": "text/html"},
                text="<html>public job page</html>",
            )

        page = await main.fetch_public_page(
            "https://jobs.example/role", transport=httpx.MockTransport(respond)
        )
        assert page == "<html>public job page</html>"
        assert len(requests) == 1
        assert requests[0].url.host == "93.184.216.34"
        assert requests[0].headers["host"] == "jobs.example"
        assert requests[0].extensions["sni_hostname"] == "jobs.example"
        assert isinstance(requests[0].extensions["sni_hostname"], str)

    asyncio.run(run())


def test_fetch_decodes_html_using_meta_charset_when_header_omits_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def resolve(_: str, __: int) -> list[str]:
        return ["93.184.216.34"]

    async def run() -> None:
        monkeypatch.setattr(main, "_resolve_public_ips", resolve)
        html = '<meta charset="windows-1252"><h1>IT Administrator – MAZIV</h1>'
        transport = httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                headers={"Content-Type": "text/html"},
                content=html.encode("cp1252"),
            )
        )

        page = await main.fetch_public_page("https://jobs.example/role", transport=transport)

        assert page == html
        assert "�" not in page

    asyncio.run(run())


def test_upstream_timeout_is_a_clear_gateway_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    async def resolve(_: str, __: int) -> list[str]:
        return ["93.184.216.34"]

    async def run() -> None:
        monkeypatch.setattr(main, "_resolve_public_ips", resolve)

        def timeout(_: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("timeout")

        with pytest.raises(main.ExtractionError) as error:
            await main.fetch_public_page(
                "https://jobs.example/role", transport=httpx.MockTransport(timeout)
            )
        assert error.value.status_code == 504

    asyncio.run(run())


def test_request_body_size_is_limited() -> None:
    response = client.post(
        "/api/job-extraction",
        content=b"x" * (main.MAX_REQUEST_BYTES + 1),
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "request_too_large"
