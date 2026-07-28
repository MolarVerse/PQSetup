from __future__ import annotations

import importlib.util
import os
import re
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from .external_qm import advertised_script_names, external_qm_config
from .models import ExternalQMCapabilities, RunnerStatus


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
    ready: bool | None = None,
    executable: str | None = None,
    supported: bool = True,
    detail: str | None = None,
) -> RunnerStatus:
    if detail is None:
        detail = "Detected." if installed and supported else "Not detected."
    return RunnerStatus(
        id=runner_id,
        label=label,
        supported=supported,
        installed=installed,
        ready=(installed if ready is None else ready) and supported,
        executable=executable,
        version=_version(executable),
        detail=detail,
    )


def _pq_script_directories(pq_executable: str | None) -> tuple[Path, ...]:
    if not pq_executable:
        return ()

    resolved = shutil.which(pq_executable)
    path = Path(resolved or pq_executable).expanduser().resolve(strict=False)
    executable_directory = path if path.is_dir() else path.parent
    prefix = executable_directory.parent
    candidates = (
        executable_directory / "scripts",
        executable_directory / "src" / "QM" / "scripts",
        prefix / "scripts",
        prefix / "src" / "QM" / "scripts",
        prefix / "lib" / "PQ" / "scripts",
        prefix / "lib" / "pq" / "scripts",
        prefix / "libexec" / "PQ" / "scripts",
        prefix / "share" / "PQ" / "scripts",
        prefix / "share" / "pq" / "scripts",
    )
    return tuple(dict.fromkeys(candidates))


def _pq_script(
    pq_executable: str | None,
    runner_id: str,
    script_names: tuple[str, ...] | None = None,
) -> Path | None:
    names = (
        advertised_script_names(None).get(runner_id, ())
        if script_names is None
        else script_names
    )
    if not names:
        return None
    return next(
        (
            candidate
            for directory in _pq_script_directories(pq_executable)
            for script_name in names
            if (candidate := directory / script_name).is_file()
        ),
        None,
    )


def _external_detail(
    dependency: str,
    *,
    detected: bool,
    pq_checked: bool,
    script_found: bool,
    script_mode: str,
) -> str:
    dependency_state = (
        f"{dependency} detected." if detected else f"{dependency} not detected."
    )
    if not pq_checked:
        return f"{dependency_state} PQ script not checked."
    if script_mode == "full_path_only":
        return f"{dependency_state} PQ requires a full QM script path."
    script_state = (
        "PQ script found."
        if script_found
        else "PQ script not found near the selected PQ executable."
    )
    return f"{dependency_state} {script_state}"


@lru_cache(maxsize=8)
def _detect_runners(
    pq_executable: str | None = None,
    external_scripts: tuple[tuple[str, tuple[str, ...]], ...] | None = None,
    script_mode: str = "bundled_or_full_path",
) -> tuple[RunnerStatus, ...]:
    dftb = _binary(("dftb+",))
    turbomole = _binary(("ridft", "dscf"))
    ase_ready = _module("ase")
    pyscf_ready = _module("pyscf")
    mace_ready = _module("mace")
    pq_checked = pq_executable is not None
    scripts = (
        advertised_script_names(None)
        if external_scripts is None
        else dict(external_scripts)
    )
    dftb_script = _pq_script(
        pq_executable,
        "dftbplus",
        scripts.get("dftbplus", ()),
    )
    pyscf_script = _pq_script(
        pq_executable,
        "pyscf",
        scripts.get("pyscf", ()),
    )
    turbomole_script = _pq_script(
        pq_executable,
        "turbomole",
        scripts.get("turbomole", ()),
    )
    turbomole_ready = bool(turbomole) or bool(os.environ.get("TURBODIR"))
    bundled_scripts_supported = script_mode == "bundled_or_full_path"
    return (
        _status(
            "dftbplus",
            "DFTB+",
            installed=bool(dftb),
            ready=bool(dftb)
            and (
                bundled_scripts_supported and bool(dftb_script) if pq_checked else True
            ),
            executable=dftb,
            detail=_external_detail(
                "DFTB+",
                detected=bool(dftb),
                pq_checked=pq_checked,
                script_found=bool(dftb_script),
                script_mode=script_mode,
            ),
        ),
        _status(
            "ase_dftbplus",
            "ASE · DFTB+",
            installed=ase_ready and bool(dftb),
            executable=dftb,
            detail=(
                "ASE and DFTB+ detected."
                if ase_ready and dftb
                else "ASE or DFTB+ not detected."
            ),
        ),
        _status(
            "ase_xtb",
            "ASE · xTB",
            installed=ase_ready and bool(dftb),
            executable=dftb,
            detail=(
                "ASE and DFTB+ detected for the xTB Hamiltonian."
                if ase_ready and dftb
                else "ASE or DFTB+ not detected."
            ),
        ),
        _status(
            "pyscf",
            "PySCF",
            installed=pyscf_ready,
            ready=pyscf_ready
            and (
                bundled_scripts_supported and bool(pyscf_script) if pq_checked else True
            ),
            detail=_external_detail(
                "PySCF",
                detected=pyscf_ready,
                pq_checked=pq_checked,
                script_found=bool(pyscf_script),
                script_mode=script_mode,
            ),
        ),
        _status(
            "turbomole",
            "Turbomole",
            installed=turbomole_ready,
            ready=turbomole_ready
            and (
                bundled_scripts_supported and bool(turbomole_script)
                if pq_checked
                else True
            ),
            executable=turbomole,
            detail=_external_detail(
                "Turbomole",
                detected=turbomole_ready,
                pq_checked=pq_checked,
                script_found=bool(turbomole_script),
                script_mode=script_mode,
            ),
        ),
        _status(
            "mace_mp",
            "MACE-MP",
            installed=mace_ready,
            detail="MACE detected." if mace_ready else "MACE not detected.",
        ),
        _status(
            "mace_off",
            "MACE-OFF",
            installed=mace_ready,
            detail="MACE detected." if mace_ready else "MACE not detected.",
        ),
    )


def detect_runners(
    pq_executable: str | Path | None = None,
    *,
    external_qm: ExternalQMCapabilities | None = None,
) -> list[RunnerStatus]:
    context = str(Path(pq_executable).expanduser()) if pq_executable else None
    config = external_qm_config(external_qm)
    scripts = tuple(sorted(advertised_script_names(external_qm).items()))
    return [
        status.model_copy(deep=True)
        for status in _detect_runners(context, scripts, config.script_mode)
    ]
