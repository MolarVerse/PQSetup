from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .external_qm import parse_external_qm
from .models import PQStatus, PQValidationScope


_VERSION_LINE = re.compile(r"^\s*Version:\s*(\S+)", re.MULTILINE)


def default_config_path() -> Path:
    config_root = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return config_root / "pqsetup" / "config.json"


def configured_executable(config_path: Path | None = None) -> str | None:
    path = config_path or default_config_path()
    if not path.is_file():
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8")).get("pq_executable")
    except (OSError, ValueError, AttributeError):
        return None
    return str(value) if value else None


def _candidate_status(candidate: str, source: str) -> PQStatus | None:
    resolved = shutil.which(candidate)
    path = Path(resolved or candidate).expanduser()
    if not path.is_file() or not os.access(path, os.X_OK):
        return None
    version, capabilities = _probe_capabilities(path)
    if version is None:
        version = _probe_banner(path)
    validation_scopes = _validation_scopes(capabilities)
    return PQStatus(
        found=True,
        executable=str(path.resolve()),
        version=version,
        source=source,
        detail=(
            f"PQ {version} is ready."
            if version
            else "PQ executable found; version unavailable."
        ),
        capabilities=capabilities,
        external_qm=parse_external_qm(capabilities),
        validation_available=bool(validation_scopes),
        validation_scopes=validation_scopes,
    )


def _probe_capabilities(
    path: Path,
) -> tuple[str | None, dict[str, Any] | None]:
    try:
        result = subprocess.run(
            [str(path), "--capabilities=json"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (OSError, UnicodeError, subprocess.SubprocessError):
        return None, None
    if result.returncode == 0:
        try:
            payload = json.loads(result.stdout)
        except ValueError:
            return None, None
        if not isinstance(payload, dict):
            return None, None
        version = payload.get("version")
        capabilities = (
            payload
            if payload.get("schema") == "pq.capabilities"
            and type(payload.get("schema_version")) is int
            and payload["schema_version"] == 1
            else None
        )
        return (str(version) if version else None), capabilities
    return None, None


def _validation_scopes(
    capabilities: dict[str, Any] | None,
) -> list[PQValidationScope]:
    if capabilities is None:
        return []
    cli = capabilities.get("cli")
    if not isinstance(cli, dict):
        return []
    validation = cli.get("input_validation")
    if not isinstance(validation, dict):
        return []
    formats = validation.get("formats")
    scopes = validation.get("scopes")
    if not (
        validation.get("schema") == "pq.validation"
        and type(validation.get("schema_version")) is int
        and validation["schema_version"] == 1
        and isinstance(formats, list)
        and all(isinstance(item, str) for item in formats)
        and "json" in formats
        and isinstance(scopes, list)
        and all(isinstance(item, str) for item in scopes)
    ):
        return []
    supported: list[PQValidationScope] = []
    for scope in ("portable", "installed"):
        if scope in scopes:
            supported.append(scope)
    return supported


def _probe_banner(path: Path) -> str | None:
    try:
        with tempfile.TemporaryDirectory(prefix="pqsetup-version-") as directory:
            probe = Path(directory) / "version-probe.in"
            probe.write_text("jobtype = qm-md;\n", encoding="utf-8")
            result = subprocess.run(
                [str(path), probe.name],
                cwd=directory,
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
    except (OSError, UnicodeError, subprocess.SubprocessError):
        return None
    match = _VERSION_LINE.search(f"{result.stdout}\n{result.stderr}")
    return match.group(1) if match else None


def discover_pq(
    explicit: str | None = None,
    *,
    config_path: Path | None = None,
) -> PQStatus:
    configured_candidates: list[tuple[str | None, str]] = [
        (explicit, "option"),
        (configured_executable(config_path), "config"),
        (os.environ.get("PQ_EXECUTABLE"), "environment"),
    ]
    for candidate, source in configured_candidates:
        if not candidate:
            continue
        if status := _candidate_status(candidate, source):
            return status
        return PQStatus(
            found=False,
            executable=candidate,
            source=source,
            detail=f"The PQ executable selected by {source} is not executable.",
        )

    candidates: list[tuple[str | None, str]] = [
        (shutil.which("PQ"), "PATH"),
        (shutil.which("pq"), "PATH"),
    ]
    projects_root = Path(__file__).resolve().parents[2]
    candidates.append(
        (str(projects_root / "PQ" / "build" / "apps" / "PQ"), "development")
    )
    for candidate, source in candidates:
        if candidate and (status := _candidate_status(candidate, source)):
            return status
    return PQStatus(
        found=False,
        detail=("PQ was not found. Set PQ_EXECUTABLE or choose it in settings."),
    )
