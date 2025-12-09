import io

from fastapi.testclient import TestClient

from app.main import app
import app.api.routes as routes


client = TestClient(app)


def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_status_basic_fields():
    response = client.get("/status")
    assert response.status_code == 200
    data = response.json()
    assert "free_bytes" in data
    assert "minutes_remaining" in data
    assert "card_present" in data


def test_live_stream_uses_streaming_response(monkeypatch):
    class FakeProc:
        def __init__(self):
            # Provide a finite byte stream so the response can complete.
            self.stdout = io.BytesIO(b"0" * 8192)

        def terminate(self):  # pragma: no cover - no-op in test
            pass

        def kill(self):  # pragma: no cover - no-op in test
            pass

    def fake_popen(*args, **kwargs):  # pragma: no cover - simple stub
        return FakeProc()

    monkeypatch.setattr(routes.subprocess, "Popen", fake_popen)

    response = client.get("/live/stream")
    assert response.status_code == 200
    content_type = response.headers.get("content-type", "")
    assert "audio/webm" in content_type
    # Body should contain some streamed bytes from the fake process.
    assert response.content

