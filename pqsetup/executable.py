from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from .models import PQStatus


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
    version = _probe_version(path)
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
    )


def _probe_version(path: Path) -> str | None:
    version = _probe_capabilities(path)
    return version or _probe_banner(path)


def _probe_capabilities(path: Path) -> str | None:
    try:
        result = subprocess.run(
            [str(path), "--capabilities=json"],
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode == 0:
        try:
            payload = json.loads(result.stdout)
        except ValueError:
            return None
        version = payload.get("version")
        return str(version) if version else None
    return None


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
    except (OSError, subprocess.SubprocessError):
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
