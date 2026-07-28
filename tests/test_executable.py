from __future__ import annotations

import json
from pathlib import Path

from pqsetup.executable import discover_pq


def make_pq(path: Path, version: str) -> Path:
    capabilities = {
        "schema": "pq.capabilities",
        "schema_version": 1,
        "version": version,
        "cli": {
            "input_validation": {
                "schema": "pq.validation",
                "schema_version": 1,
                "formats": ["text", "json"],
                "scopes": ["portable", "installed"],
            }
        },
        "input": {
            "external_qm": {
                "script_mode": "bundled_or_full_path",
                "programs": {
                    "pyscf": {
                        "recommended_script": None,
                        "scripts": [
                            {
                                "name": "pyscf_hf.py",
                                "label": "UHF / STO-3G",
                            },
                            {
                                "name": "pyscf_mp2.py",
                                "label": "UMP2 / 6-311++G**",
                            },
                        ],
                    }
                },
            }
        },
    }
    path.write_text(
        (f"#!/bin/sh\nprintf '%s\\n' '{json.dumps(capabilities)}'\n"),
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
    assert status.capabilities is not None
    assert status.capabilities["schema"] == "pq.capabilities"
    assert status.validation_available
    assert status.validation_scopes == ["portable", "installed"]
    assert status.external_qm is not None
    assert status.external_qm.programs["pyscf"].recommended_script is None
    assert [
        script.label for script in status.external_qm.programs["pyscf"].scripts
    ] == [
        "UHF / STO-3G",
        "UMP2 / 6-311++G**",
    ]


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
    assert status.capabilities is None
    assert not status.validation_available
    assert status.validation_scopes == []


def test_unversioned_capability_payload_is_advisory_only(
    tmp_path: Path,
) -> None:
    executable = tmp_path / "PQ-custom"
    executable.write_text(
        """#!/bin/sh
printf '%s\n' '{"version":"v0.6.5","cli":{"input_validation":{"schema":"pq.validation","schema_version":1,"formats":["json"]}}}'
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)

    status = discover_pq(str(executable))

    assert status.version == "v0.6.5"
    assert status.capabilities is None
    assert not status.validation_available


def test_validation_requires_advertised_scope_support(tmp_path: Path) -> None:
    executable = tmp_path / "PQ-custom"
    executable.write_text(
        """#!/bin/sh
printf '%s\n' '{"schema":"pq.capabilities","schema_version":1,"version":"v0.7.0","cli":{"input_validation":{"schema":"pq.validation","schema_version":1,"formats":["json"]}}}'
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)

    status = discover_pq(str(executable))

    assert not status.validation_available
    assert status.validation_scopes == []


def test_non_utf8_capabilities_do_not_break_discovery(tmp_path: Path) -> None:
    executable = tmp_path / "PQ-custom"
    executable.write_text(
        """#!/usr/bin/env python3
import sys
if sys.argv[1] == "--capabilities=json":
    sys.stdout.buffer.write(b"\\xff")
else:
    print("         Version:       v0.6.4")
""",
        encoding="utf-8",
    )
    executable.chmod(0o755)

    status = discover_pq(str(executable))

    assert status.found
    assert status.version == "v0.6.4"
    assert not status.validation_available


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
