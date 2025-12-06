from fastapi.testclient import TestClient

from app.main import app


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

