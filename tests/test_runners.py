from __future__ import annotations

from pathlib import Path

import pqsetup.runners as runners
from pqsetup.models import ExternalQMCapabilities


def _detect(
    pq_executable: Path | None = None,
    external_qm: ExternalQMCapabilities | None = None,
) -> dict[str, runners.RunnerStatus]:
    runners._detect_runners.cache_clear()
    try:
        return {
            item.id: item
            for item in runners.detect_runners(
                pq_executable=pq_executable,
                external_qm=external_qm,
            )
        }
    finally:
        runners._detect_runners.cache_clear()


def test_ase_xtb_uses_dftbplus_backend(monkeypatch) -> None:
    def binary(names: tuple[str, ...]) -> str | None:
        return "/tools/dftb+" if names == ("dftb+",) else None

    monkeypatch.setattr(runners, "_binary", binary)
    monkeypatch.setattr(runners, "_module", lambda name: name == "ase")
    monkeypatch.setattr(runners, "_version", lambda executable: "24.1")
    monkeypatch.delenv("TURBODIR", raising=False)
    statuses = _detect()

    assert statuses["ase_xtb"].installed
    assert statuses["ase_xtb"].executable == "/tools/dftb+"
    assert (
        statuses["ase_xtb"].detail == "ASE and DFTB+ detected for the xTB Hamiltonian."
    )
    assert statuses["dftbplus"].ready
    assert statuses["dftbplus"].detail == "DFTB+ detected. PQ script not checked."
    assert set(statuses) == {
        "dftbplus",
        "ase_dftbplus",
        "ase_xtb",
        "pyscf",
        "turbomole",
        "mace_mp",
        "mace_off",
    }


def test_selected_development_pq_finds_canonical_scripts(
    monkeypatch,
    tmp_path: Path,
) -> None:
    pq_executable = tmp_path / "build" / "apps" / "PQ"
    scripts = tmp_path / "build" / "src" / "QM" / "scripts"
    scripts.mkdir(parents=True)
    for script_names in runners.advertised_script_names(None).values():
        script_name = script_names[0]
        (scripts / script_name).touch()

    def binary(names: tuple[str, ...]) -> str | None:
        if names == ("dftb+",):
            return "/tools/dftb+"
        if names == ("ridft", "dscf"):
            return "/tools/ridft"
        return None

    monkeypatch.setattr(runners, "_binary", binary)
    monkeypatch.setattr(
        runners,
        "_module",
        lambda name: name in {"ase", "pyscf"},
    )
    monkeypatch.setattr(runners, "_version", lambda executable: None)
    monkeypatch.delenv("TURBODIR", raising=False)

    statuses = _detect(pq_executable)

    for runner_id in ("dftbplus", "pyscf", "turbomole"):
        assert statuses[runner_id].ready
        assert statuses[runner_id].supported
        assert statuses[runner_id].detail.endswith("PQ script found.")


def test_missing_pq_script_is_an_advisory_not_unsupported(
    monkeypatch,
    tmp_path: Path,
) -> None:
    pq_executable = tmp_path / "prefix" / "bin" / "PQ"
    monkeypatch.setattr(
        runners,
        "_binary",
        lambda names: "/tools/dftb+" if names == ("dftb+",) else None,
    )
    monkeypatch.setattr(runners, "_module", lambda name: name == "pyscf")
    monkeypatch.setattr(runners, "_version", lambda executable: None)
    monkeypatch.delenv("TURBODIR", raising=False)

    statuses = _detect(pq_executable)

    assert statuses["dftbplus"].installed
    assert not statuses["dftbplus"].ready
    assert statuses["dftbplus"].supported
    assert statuses["dftbplus"].detail == (
        "DFTB+ detected. PQ script not found near the selected PQ executable."
    )
    assert statuses["pyscf"].installed
    assert not statuses["pyscf"].ready
    assert statuses["pyscf"].supported


def test_installed_share_layout_is_checked(tmp_path: Path) -> None:
    pq_executable = tmp_path / "prefix" / "bin" / "PQ"
    script = tmp_path / "prefix" / "share" / "PQ" / "scripts" / "pyscf_hf.py"
    script.parent.mkdir(parents=True)
    script.touch()

    assert runners._pq_script(str(pq_executable), "pyscf") == script


def test_advertised_script_names_drive_installation_detection(
    monkeypatch,
    tmp_path: Path,
) -> None:
    pq_executable = tmp_path / "prefix" / "bin" / "PQ"
    script = tmp_path / "prefix" / "share" / "PQ" / "scripts" / "pyscf_next.py"
    script.parent.mkdir(parents=True)
    script.touch()
    capabilities = ExternalQMCapabilities.model_validate(
        {
            "script_mode": "bundled_or_full_path",
            "programs": {
                "pyscf": {
                    "recommended_script": None,
                    "scripts": [
                        {
                            "name": "pyscf_next.py",
                            "label": "UHF / larger basis",
                        }
                    ],
                }
            },
        }
    )
    monkeypatch.setattr(runners, "_binary", lambda _: None)
    monkeypatch.setattr(runners, "_module", lambda name: name == "pyscf")
    monkeypatch.setattr(runners, "_version", lambda _: None)
    monkeypatch.delenv("TURBODIR", raising=False)

    statuses = _detect(pq_executable, capabilities)

    assert statuses["pyscf"].ready
    assert statuses["pyscf"].detail.endswith("PQ script found.")


def test_full_path_only_build_does_not_report_bundled_scripts_as_ready(
    monkeypatch,
    tmp_path: Path,
) -> None:
    pq_executable = tmp_path / "prefix" / "bin" / "PQ"
    script = tmp_path / "prefix" / "share" / "PQ" / "scripts" / "pyscf_hf.py"
    script.parent.mkdir(parents=True)
    script.touch()
    capabilities = ExternalQMCapabilities.model_validate(
        {
            "script_mode": "full_path_only",
            "programs": {
                "pyscf": {
                    "recommended_script": None,
                    "scripts": [{"name": "pyscf_hf.py", "label": "UHF / STO-3G"}],
                }
            },
        }
    )
    monkeypatch.setattr(runners, "_binary", lambda _: None)
    monkeypatch.setattr(runners, "_module", lambda name: name == "pyscf")
    monkeypatch.setattr(runners, "_version", lambda _: None)
    monkeypatch.delenv("TURBODIR", raising=False)

    status = _detect(pq_executable, capabilities)["pyscf"]

    assert status.installed
    assert not status.ready
    assert status.detail == "PySCF detected. PQ requires a full QM script path."
