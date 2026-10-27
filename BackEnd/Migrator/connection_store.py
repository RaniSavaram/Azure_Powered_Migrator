"""
Persists saved connection details per source in a local temp file outside the
repository, so the app can remember a user's connection without committing
secrets to GitHub or workspace files.

This file is intentionally kept outside the project directory so deployment
platforms or GitHub commits do not include credential material.
"""
import json
import os
import tempfile

from django.conf import settings

SAVED_CONNECTIONS_PATH = os.environ.get(
    "DB_SCANNER_SAVED_CONNECTIONS_PATH",
    os.path.join(tempfile.gettempdir(), "db_scanner_saved_connections.json"),
)
def _get_base_dir() -> str:
    try:
        if settings.configured:
            return str(settings.BASE_DIR)
    except Exception:
        pass
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


CONFIG_SAVED_CONNECTIONS_PATH = os.path.join(_get_base_dir(), "config", "saved_connections.json")


def _load_all() -> dict:
    data = {}
    # First load base saved connections from project config if present
    if os.path.exists(CONFIG_SAVED_CONNECTIONS_PATH):
        try:
            with open(CONFIG_SAVED_CONNECTIONS_PATH, "r", encoding="utf-8") as f:
                cfg_conns = json.load(f)
                if isinstance(cfg_conns, dict):
                    data.update(cfg_conns)
        except Exception:
            pass

    # Next overlay with user saved connections from tempfile
    if os.path.exists(SAVED_CONNECTIONS_PATH):
        try:
            with open(SAVED_CONNECTIONS_PATH, "r", encoding="utf-8") as f:
                tmp_conns = json.load(f)
                if isinstance(tmp_conns, dict):
                    for k, v in tmp_conns.items():
                        data[k] = v
        except Exception:
            pass

    return data


def _write_all(connections: dict) -> None:
    os.makedirs(os.path.dirname(SAVED_CONNECTIONS_PATH), exist_ok=True)
    with open(SAVED_CONNECTIONS_PATH, "w", encoding="utf-8") as f:
        json.dump(connections, f, indent=2)


def _as_profile_list(value) -> list:
    """Normalizes a source's stored value (legacy single dict, or the
    current list-of-profiles shape) into a list, so callers never need to
    branch on which format an existing file was written in."""
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def _get_profiles_for_source(connections: dict, source: str) -> list:
    if not source:
        return []
    # Check exact, lowercase, capitalized
    s_clean = source.strip()
    s_lower = s_clean.lower()
    for key, val in connections.items():
        if key.strip().lower() == s_lower:
            return _as_profile_list(val)
    return []


def save_connection(source: str, connection: dict) -> None:
    """Upserts `connection` into the source's profile list, keyed by
    server - connecting again to a previously-saved server updates that
    profile in place rather than growing duplicates."""
    if not source:
        return
    connections = _load_all()
    s_lower = source.strip().lower()

    # Find existing key if any
    matched_key = source
    for key in connections.keys():
        if key.strip().lower() == s_lower:
            matched_key = key
            break

    profiles = _as_profile_list(connections.get(matched_key))
    server = connection.get("server")
    profiles = [p for p in profiles if p.get("server") != server]
    profiles.append(connection)
    connections[matched_key] = profiles
    # Also ensure lowercase key is synchronized for consistent lookup
    connections[s_lower] = profiles
    _write_all(connections)


DEFAULT_PROFILES = {
    "databricks": [
        {
            "server": "dbc-a58bcebf-ff15.cloud.databricks.com",
            "database": "bfsi_dev",
            "username": "",
            "password": os.environ.get("DATABRICKS_TOKEN", ""),
            "extra": {
                "http_path": "/sql/1.0/warehouses/570872a58c83ef23"
            }
        }
    ]
}


def get_saved_connection(source: str) -> dict | None:
    """Most recently saved profile for `source` - back-compat single-result
    lookup for callers that only want one connection to pre-fill with."""
    if not source:
        return None
    profiles = get_saved_connections(source)
    return profiles[-1] if profiles else None


def get_saved_connections(source: str) -> list:
    """All saved profiles for `source`, oldest first, so the frontend can
    offer a picker instead of just the last-used connection."""
    if not source:
        return []
    profiles = _get_profiles_for_source(_load_all(), source)
    if not profiles:
        s_lower = source.strip().lower()
        if s_lower in DEFAULT_PROFILES:
            return [dict(p) for p in DEFAULT_PROFILES[s_lower]]
    return profiles

