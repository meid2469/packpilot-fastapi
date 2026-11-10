"""Smoke the additive V2 mount without changing the existing V1 HTTP contract."""

from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app import app


V2_DIR = Path(__file__).resolve().parents[1] / "static" / "v2"
pytestmark = pytest.mark.skipif(
    not (V2_DIR / "index.html").exists(), reason="Copy V2 frontend to static/v2 before integration checks"
)


def test_v2_page_is_served():
    with TestClient(app) as client:
        response = client.get("/v2/")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]
        assert response.content == (V2_DIR / "index.html").read_bytes()
        assert client.get("/v2").status_code == 200


def test_v1_home_and_health_remain_available():
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
        assert response.content == (V2_DIR.parent / "index.html").read_bytes()
        assert client.get("/health").json() == {
            "status": "ok", "service": "packpilot", "version": "1.0.0"
        }
