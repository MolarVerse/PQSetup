from __future__ import annotations

import json
from pathlib import Path

import pytest

from pqsetup.pq_validation import PQValidationError, validate_pq_input


def _validator(
    path: Path,
    *,
    payload: dict[str, object] | None,
    returncode: int,
    stderr: str = "",
) -> Path:
    response = json.dumps(payload) if payload is not None else "not json"
    path.write_text(
        f"""#!/usr/bin/env python3
import json
import pathlib
import sys

pathlib.Path("invocation.json").write_text(
    json.dumps({{"arguments": sys.argv[1:], "cwd": str(pathlib.Path.cwd())}})
)
print({response!r})
print({stderr!r}, file=sys.stderr, end="")
raise SystemExit({returncode})
""",
        encoding="utf-8",
    )
    path.chmod(0o755)
    return path


def _payload(
    *,
    valid: bool,
    scope: str = "installed",
    input_name: str = "run.in",
) -> dict[str, object]:
    return {
        "schema": "pq.validation",
        "schema_version": 1,
        "valid": valid,
        "input": input_name,
        "scope": scope,
        "diagnostics": [
            {
                "severity": "warning" if valid else "error",
                "message": "Check the coupling.",
                "file": "run.in",
                "line": 12,
                "keyword": "coupling_frequency",
            }
        ],
    }


def test_validation_uses_the_input_directory_and_preserves_diagnostics(
    tmp_path: Path,
) -> None:
    input_file = tmp_path / "run.in"
    input_file.write_text("jobtype = qm-md;\n", encoding="utf-8")
    executable = _validator(
        tmp_path / "PQ",
        payload=_payload(valid=True, scope="portable"),
        returncode=0,
    )

    result = validate_pq_input(
        str(executable),
        input_file,
        scope="portable",
    )

    invocation = json.loads((tmp_path / "invocation.json").read_text())
    assert invocation == {
        "arguments": [
            "--validate",
            "run.in",
            "--format=json",
            "--scope=portable",
        ],
        "cwd": str(tmp_path),
    }
    assert result.valid
    assert result.diagnostics[0].line == 12
    assert result.diagnostics[0].model_dump()["keyword"] == "coupling_frequency"


def test_invalid_input_is_a_validation_result(tmp_path: Path) -> None:
    input_file = tmp_path / "run.in"
    input_file.write_text("nstep = 0;\n", encoding="utf-8")
    executable = _validator(
        tmp_path / "PQ",
        payload=_payload(valid=False),
        returncode=1,
    )

    result = validate_pq_input(str(executable), input_file)

    assert not result.valid
    assert result.diagnostics[0].severity == "error"


@pytest.mark.parametrize(
    ("payload", "returncode", "message"),
    [
        (_payload(valid=False), 0, "does not match"),
        (
            {**_payload(valid=True), "schema_version": 2},
            0,
            "invalid input-validation response",
        ),
        (None, 0, "invalid input-validation response"),
        (_payload(valid=True), 2, "input validation failed"),
    ],
)
def test_broken_validation_contract_fails_safely(
    tmp_path: Path,
    payload: dict[str, object] | None,
    returncode: int,
    message: str,
) -> None:
    input_file = tmp_path / "run.in"
    input_file.write_text("jobtype = qm-md;\n", encoding="utf-8")
    executable = _validator(
        tmp_path / "PQ",
        payload=payload,
        returncode=returncode,
    )

    with pytest.raises(PQValidationError, match=message):
        validate_pq_input(str(executable), input_file)


@pytest.mark.parametrize(
    ("payload", "returncode", "message"),
    [
        (
            _payload(valid=True, input_name="other.in"),
            0,
            "different input",
        ),
        (
            _payload(valid=True, scope="portable"),
            0,
            "wrong scope",
        ),
        (
            {
                **_payload(valid=True),
                "diagnostics": [
                    {
                        "severity": "error",
                        "message": "Broken.",
                        "file": "run.in",
                        "line": 1,
                    }
                ],
            },
            0,
            "marked input valid",
        ),
        (
            {
                **_payload(valid=False),
                "diagnostics": [
                    {
                        "severity": "warning",
                        "message": "Review.",
                        "file": "run.in",
                        "line": 1,
                    }
                ],
            },
            1,
            "without an error diagnostic",
        ),
    ],
)
def test_validation_rejects_inconsistent_payloads(
    tmp_path: Path,
    payload: dict[str, object],
    returncode: int,
    message: str,
) -> None:
    input_file = tmp_path / "run.in"
    input_file.write_text("jobtype = qm-md;\n", encoding="utf-8")
    executable = _validator(
        tmp_path / "PQ",
        payload=payload,
        returncode=returncode,
    )

    with pytest.raises(PQValidationError, match=message):
        validate_pq_input(str(executable), input_file)


def test_validation_rejects_stderr_and_non_utf8_output(tmp_path: Path) -> None:
    input_file = tmp_path / "run.in"
    input_file.write_text("jobtype = qm-md;\n", encoding="utf-8")
    with_stderr = _validator(
        tmp_path / "PQ-stderr",
        payload=_payload(valid=True),
        returncode=0,
        stderr="unexpected warning",
    )
    non_utf8 = tmp_path / "PQ-non-utf8"
    non_utf8.write_text(
        """#!/usr/bin/env python3
import sys
sys.stdout.buffer.write(b"\\xff")
""",
        encoding="utf-8",
    )
    non_utf8.chmod(0o755)

    with pytest.raises(PQValidationError, match="wrote to stderr"):
        validate_pq_input(str(with_stderr), input_file)
    with pytest.raises(PQValidationError, match="non-UTF-8"):
        validate_pq_input(str(non_utf8), input_file)


def test_validation_reports_process_start_failure(tmp_path: Path) -> None:
    input_file = tmp_path / "run.in"
    input_file.write_text("jobtype = qm-md;\n", encoding="utf-8")

    with pytest.raises(PQValidationError, match="could not be started"):
        validate_pq_input(str(tmp_path / "missing-PQ"), input_file)
