from __future__ import annotations

import json
import subprocess
from pathlib import Path

from pydantic import ValidationError

from .models import PQValidationResult, PQValidationScope


class PQValidationError(RuntimeError):
    pass


def validate_pq_input(
    executable: str,
    input_file: Path,
    *,
    scope: PQValidationScope = "installed",
    timeout: float = 10,
) -> PQValidationResult:
    path = input_file.resolve()
    try:
        completed = subprocess.run(
            [
                executable,
                "--validate",
                path.name,
                "--format=json",
                f"--scope={scope}",
            ],
            cwd=path.parent,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise PQValidationError("PQ input validation timed out.") from error
    except (OSError, subprocess.SubprocessError) as error:
        raise PQValidationError(f"PQ could not be started: {error}") from error

    try:
        stdout = completed.stdout.decode("utf-8")
        stderr = completed.stderr.decode("utf-8")
    except UnicodeDecodeError as error:
        raise PQValidationError(
            "PQ returned non-UTF-8 input-validation output."
        ) from error

    if completed.returncode not in {0, 1}:
        detail = stderr.strip() or f"exit code {completed.returncode}"
        raise PQValidationError(f"PQ input validation failed: {detail}")
    if stderr.strip():
        raise PQValidationError(
            f"PQ input validation wrote to stderr: {stderr.strip()}"
        )

    try:
        payload = json.loads(stdout)
        result = PQValidationResult.model_validate(payload)
    except (ValueError, ValidationError) as error:
        raise PQValidationError(
            "PQ returned an invalid input-validation response."
        ) from error

    expected_returncode = 0 if result.valid else 1
    if completed.returncode != expected_returncode:
        raise PQValidationError(
            "PQ input-validation status does not match its exit code."
        )
    if result.input != path.name:
        raise PQValidationError("PQ input-validation response names a different input.")
    if result.scope != scope:
        raise PQValidationError("PQ input-validation response has the wrong scope.")
    has_error = any(diagnostic.severity == "error" for diagnostic in result.diagnostics)
    if result.valid and has_error:
        raise PQValidationError(
            "PQ marked input valid but returned an error diagnostic."
        )
    if not result.valid and not has_error:
        raise PQValidationError("PQ marked input invalid without an error diagnostic.")
    return result
