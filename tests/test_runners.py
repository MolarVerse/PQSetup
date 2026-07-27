from __future__ import annotations

import pqsetup.runners as runners


def test_ase_xtb_uses_dftbplus_backend(monkeypatch) -> None:
    def binary(names: tuple[str, ...]) -> str | None:
        return "/tools/dftb+" if names == ("dftb+",) else None

    monkeypatch.setattr(runners, "_binary", binary)
    monkeypatch.setattr(runners, "_module", lambda name: name == "ase")
    monkeypatch.setattr(runners, "_version", lambda executable: "24.1")
    runners._detect_runners.cache_clear()
    try:
        statuses = {item.id: item for item in runners.detect_runners()}
    finally:
        runners._detect_runners.cache_clear()

    assert statuses["ase_xtb"].installed
    assert statuses["ase_xtb"].executable == "/tools/dftb+"
    assert statuses["ase_xtb"].detail == "Uses DFTB+ with its xTB Hamiltonian."
    assert set(statuses) == {
        "dftbplus",
        "ase_dftbplus",
        "ase_xtb",
        "pyscf",
        "turbomole",
        "mace_mp",
        "mace_off",
    }
