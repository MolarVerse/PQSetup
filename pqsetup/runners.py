from __future__ import annotations

import importlib.util
import os
import re
import shutil
import subprocess
from functools import lru_cache

from .models import RunnerStatus


def _binary(candidates: tuple[str, ...]) -> str | None:
    return next((path for name in candidates if (path := shutil.which(name))), None)


def _module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def _version(executable: str | None) -> str | None:
    if not executable:
        return None
    for argument in ("--version", "-v"):
        try:
            result = subprocess.run(
                [executable, argument],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            return None
        output = (result.stdout or result.stderr).strip().splitlines()
        joined = "\n".join(output)
        dftb_release = re.search(r"DFTB\+\s+release\s+([^\s|]+)", joined, re.IGNORECASE)
        if dftb_release:
            return dftb_release.group(1)
        if output:
            meaningful = next(
                (line.strip(" |") for line in output if line.strip(" |=")),
                None,
            )
            return meaningful[:120] if meaningful else None
    return None


def _status(
    runner_id: str,
    label: str,
    *,
    installed: bool,
    executable: str | None = None,
    supported: bool = True,
    detail: str | None = None,
) -> RunnerStatus:
    if detail is None:
        detail = "Ready." if installed and supported else "Not installed."
    return RunnerStatus(
        id=runner_id,
        label=label,
        supported=supported,
        installed=installed,
        ready=installed and supported,
        executable=executable,
        version=_version(executable),
        detail=detail,
    )


@lru_cache(maxsize=1)
def _detect_runners() -> tuple[RunnerStatus, ...]:
    dftb = _binary(("dftb+",))
    turbomole = _binary(("ridft", "dscf"))
    g16 = _binary(("g16", "g09"))
    ase_ready = _module("ase")
    mace_ready = _module("mace")
    return (
        _status("dftbplus", "DFTB+", installed=bool(dftb), executable=dftb),
        _status(
            "ase_dftbplus",
            "ASE · DFTB+",
            installed=ase_ready and bool(dftb),
            executable=dftb,
        ),
        _status(
            "ase_xtb",
            "ASE · xTB",
            installed=ase_ready and bool(dftb),
            executable=dftb,
            detail=(
                "Uses DFTB+ with its xTB Hamiltonian."
                if ase_ready and dftb
                else "ASE or DFTB+ is missing."
            ),
        ),
        _status("pyscf", "PySCF", installed=_module("pyscf")),
        _status(
            "turbomole",
            "Turbomole",
            installed=bool(turbomole) or bool(os.environ.get("TURBODIR")),
            executable=turbomole,
        ),
        _status("fennol", "FeNNol", installed=_module("fennol")),
        _status("mace_mp", "MACE-MP", installed=mace_ready),
        _status("mace_off", "MACE-OFF", installed=mace_ready),
        _status(
            "mace_cpp",
            "MACE.cpp",
            installed=False,
            detail="Check support in the selected PQ build.",
        ),
        _status(
            "g16",
            "Gaussian 16",
            installed=bool(g16),
            executable=g16,
            supported=False,
            detail=(
                "Installed, but unsupported by PQ."
                if g16
                else "Not installed and unsupported by PQ."
            ),
        ),
    )


def detect_runners() -> list[RunnerStatus]:
    return [status.model_copy(deep=True) for status in _detect_runners()]
