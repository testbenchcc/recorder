from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.core.config import settings


client = TestClient(app)


def test_recordings_unified_list_includes_storage_metadata(tmp_path, monkeypatch):
    # Point local recordings root at a temporary directory so we do not
    # depend on any real recordings on disk.
    monkeypatch.setattr(settings, "recordings_local_root", str(tmp_path))
    monkeypatch.setattr(settings, "secondary_storage_enabled", False)

    recordings_dir = Path(settings.get_local_recordings_root())
    recordings_dir.mkdir(parents=True, exist_ok=True)

    # Create a single dummy recording file that matches the expected
    # naming pattern <timestamp>_<32-hex-id>.wav so the storage scanner
    # can infer its recording id.
    recording_id = "0" * 32
    filename = f"20250101T120000_{recording_id}.wav"
    path = recordings_dir / filename
    path.write_bytes(b"0" * 64000)

    response = client.get("/recordings?limit=10")
    assert response.status_code == 200
    data = response.json()
    items = data.get("items", [])

    match = next((item for item in items if item.get("id") == recording_id), None)
    assert match is not None

    # Unified listing should surface storage metadata and accessibility.
    assert "storage_location" in match
    assert match["storage_location"] in {"local", "both"}
    assert match.get("accessible") is True
    assert "relative_path" in match
    assert "keep_local" in match
    assert isinstance(match["keep_local"], bool)
