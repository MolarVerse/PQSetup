from __future__ import annotations

import json
from pathlib import Path

from pqsetup.executable import discover_pq


def make_pq(path: Path, version: str) -> Path:
    path.write_text(
        f"#!/bin/sh\nprintf '%s\\n' '{{\"version\":\"{version}\"}}'\n",
        encoding="utf-8",
    )
    path.chmod(0o755)
    return path


def test_custom_executable_name_and_version_are_supported(
    tmp_path: Path,
) -> None:
    executable = make_pq(tmp_path / "simulation-engine", "2.4.0")

    status = discover_pq(str(executable))

    assert status.found
    assert status.executable == str(executable.resolve())
    assert status.version == "2.4.0"
    assert status.source == "option"
    assert "PQ 2.4.0 is ready" in status.detail


def test_version_is_read_from_the_pq_startup_banner(tmp_path: Path) -> None:
    executable = tmp_path / "PQ-custom"
    executable.write_text(
        """#!/bin/sh
if [ "$1" = "--capabilities=json" ]; then
  printf '%s\n' 'Invalid flag: --capabilities=json'
else
  printf '%s\n' '         Version:       v0.6.4-a1b2c3d4'
fi
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)

    status = discover_pq(str(executable))

    assert status.found
    assert status.version == "v0.6.4-a1b2c3d4"
    assert status.detail == "PQ v0.6.4-a1b2c3d4 is ready."


def test_configured_executable_precedes_environment(
    tmp_path: Path,
    monkeypatch,
) -> None:
    configured = make_pq(tmp_path / "configured-pq", "2.0")
    environment = make_pq(tmp_path / "environment-pq", "3.0")
    config = tmp_path / "config.json"
    config.write_text(
        json.dumps({"pq_executable": str(configured)}),
        encoding="utf-8",
    )
    monkeypatch.setenv("PQ_EXECUTABLE", str(environment))

    status = discover_pq(config_path=config)

    assert status.executable == str(configured.resolve())
    assert status.version == "2.0"
    assert status.source == "config"


def test_invalid_explicit_executable_is_not_silently_replaced() -> None:
    status = discover_pq("/missing/custom-pq")

    assert not status.found
    assert status.executable == "/missing/custom-pq"
    assert status.source == "option"
    assert "not executable" in status.detail
