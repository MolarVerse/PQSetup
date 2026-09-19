"""Advanced keywords: what PQ v0.7.x accepts, mirrored by ``pqsetup.keywords``."""

from __future__ import annotations

import pytest

from pqsetup.input_writer import render_input, validate_setup
from pqsetup.keywords import KEYWORDS, GENERATED_KEYS, lookup
from pqsetup.mm import required_mm_file_roles, validate_mm_setup_files
from pqsetup.models import SetupFileReference, SimulationSetup


def _codes(setup: SimulationSetup, prefix: str = "input.extra") -> list[str]:
    return [item.code for item in validate_setup(setup) if item.code.startswith(prefix)]


def _messages(setup: SimulationSetup) -> str:
    return " ".join(item.message for item in validate_setup(setup))


def _mm(**overrides: object) -> SimulationSetup:
    base: dict[str, object] = {
        "job_type": "mm-md",
        "mm_force_field": "on",
        "moldescriptor_file": "moldescriptor.dat",
        "topology_file": "topology.dat",
        "parameter_file": "parameter.dat",
    }
    base.update(overrides)
    return SimulationSetup(**base)  # type: ignore[arg-type]


def test_keyword_table_is_consistent() -> None:
    names = [keyword.name.replace("-", "_").lower() for keyword in KEYWORDS]
    assert len(names) == len(set(names))
    assert not set(names) & GENERATED_KEYS
    for keyword in KEYWORDS:
        if keyword.kind == "choice":
            assert keyword.choices, keyword.name
        else:
            assert not keyword.choices, keyword.name
    assert lookup("cell_list") is lookup("cell-list")
    assert lookup("Cell-List") is not None


@pytest.mark.parametrize(
    ("setup", "fragment"),
    [
        (
            SimulationSetup(runner="ase_xtb", extra_settings={"xtb_method": "gfn0"}),
            "gfn1-xtb, gfn2-xtb, ipea1-xtb",
        ),
        (
            SimulationSetup(runner="ase_dftbplus", extra_settings={"slakos": "custom"}),
            "slakos_path",
        ),
        (
            SimulationSetup(
                runner="ase_dftbplus",
                extra_settings={"slakos": "matsci", "hubbard_derivs": "O: -0.14"},
            ),
            "third-order",
        ),
        (
            SimulationSetup(
                runner="ase_dftbplus", extra_settings={"hubbard_derivs": "O -0.14"}
            ),
            "C: -0.1492",
        ),
        (
            SimulationSetup(runner="mace_mp", extra_settings={"mace_model": "custom"}),
            "mace_model_path",
        ),
        (
            SimulationSetup(
                runner="mace_mp", extra_settings={"mace_model_path": "/models/x.model"}
            ),
            "mace_model = custom",
        ),
        (
            SimulationSetup(runner="mace_off", extra_settings={"mace_model": "large-0b2"}),
            "MACE-OFF",
        ),
        (
            SimulationSetup(runner="ase_xtb", extra_settings={"dispersion": "maybe"}),
            "on/off",
        ),
        (_mm(extra_settings={"cell-number": 0}), "at least 1"),
        (_mm(extra_settings={"shake-tolerance": 0}), "greater than 0"),
        (_mm(extra_settings={"rf_epsilon": 0.5}), "at least 1"),
        (_mm(extra_settings={"long_range": "ewald"}), "none, shifted"),
        (_mm(extra_settings={"virial": "tensor"}), "molecular, atomic"),
        (_mm(extra_settings={"shake": "mshake"}), "mshake_file"),
        (
            _mm(extra_settings={"cell-list": "on"}, coulomb_cutoff_angstrom=0.0),
            "Coulomb cutoff",
        ),
        (
            SimulationSetup(runner="ase_xtb", extra_settings={"cell-list": "on"}),
            "pure QM",
        ),
    ],
)
def test_values_pq_rejects_are_errors(setup: SimulationSetup, fragment: str) -> None:
    errors = [item for item in validate_setup(setup) if item.severity == "error"]
    assert any(fragment in item.message for item in errors), [
        item.message for item in errors
    ]


def test_accepted_values_pass_in_either_spelling() -> None:
    qm = SimulationSetup(
        runner="ase_dftbplus",
        extra_settings={
            "slakos": "custom",
            "slakos_path": "/opt/skf",
            "third_order": "yes",
            "hubbard_derivs": "C: -0.1492, H: -0.1857",
            "qm_loop_time_limit": 0,
            "remove-net-force": True,
        },
    )
    assert _codes(qm) == []
    mm = _mm(
        extra_settings={
            "long-range": "Reaction-Field",
            "rf_epsilon": 78.5,
            "cell_list": "on",
            "cell_number": 9,
            "shake": "shake",
            "rattle-tolerance": 1e4,
            "virial": "atomic",
        }
    )
    assert _codes(mm) == []


def test_out_of_scope_keys_warn_and_unknown_keys_are_left_to_pq() -> None:
    result = validate_setup(
        SimulationSetup(
            runner="ase_xtb", extra_settings={"noncoulomb": "lj", "slakos": "3ob"}
        )
    )
    scope = [item for item in result if item.code == "input.extra_scope"]
    assert {item.severity for item in scope} == {"warning"}
    assert any("QM runs" in item.message for item in scope)
    assert any("this calculator" in item.message for item in scope)

    unknown = validate_setup(SimulationSetup(extra_settings={"my_future_key": 1}))
    assert [item.code for item in unknown] == ["input.extra_unknown"]
    assert unknown[0].severity == "warning"


def test_qm_runs_may_constrain_bonds_through_a_topology() -> None:
    from pqsetup.setup_files import required_qm_file_roles, validate_qm_setup_files

    shaken = SimulationSetup(runner="ase_xtb", extra_settings={"shake": "on"})
    assert any(item.code == "qm.topology_file" for item in validate_setup(shaken))
    assert "input.extra_scope" not in _codes(shaken)
    assert required_qm_file_roles(shaken) == ("topology",)
    assert required_qm_file_roles(SimulationSetup(runner="ase_xtb")) == ()

    named = shaken.model_copy(update={"topology_file": "topology.dat"})
    assert not [item for item in validate_setup(named) if item.severity == "error"]
    text = render_input(named).input_text
    assert "topology_file = topology.dat;" in text
    assert "shake = on;" in text
    missing = validate_qm_setup_files(named, [])
    assert any(item.code == "qm.file_missing.topology" for item in missing)

    distance = SimulationSetup(
        runner="ase_xtb", extra_settings={"distance-constraints": "on"}
    )
    assert required_qm_file_roles(distance) == ("topology",)

    mshake = SimulationSetup(runner="ase_xtb", extra_settings={"shake": "mshake"})
    assert "MM runs" in _messages(mshake)


def test_duplicate_spellings_are_refused() -> None:
    setup = _mm(extra_settings={"cell-list": "on", "cell_list": "off"})
    assert "input.extra_conflict" in _codes(setup)


def test_virial_is_written_in_place_and_never_twice() -> None:
    text = render_input(_mm(extra_settings={"virial": "atomic"})).input_text
    assert text.count("virial = ") == 1
    assert "virial = atomic;" in text
    assert "virial = molecular;" in render_input(_mm()).input_text


def test_mshake_adds_a_required_file_and_its_keyword() -> None:
    setup = _mm(
        mshake_file="mshake.dat",
        extra_settings={"shake": "mshake", "mshake-iter": 50},
    )
    assert required_mm_file_roles("on", setup) == (
        "moldescriptor",
        "topology",
        "parameter",
        "mshake",
    )
    assert required_mm_file_roles("on") == ("moldescriptor", "topology", "parameter")
    assert required_mm_file_roles("off", setup) == ("moldescriptor", "guff")

    text = render_input(setup).input_text
    assert "mshake_file = mshake.dat;" in text
    assert "shake = mshake;" in text
    assert "mshake-iter = 50;" in text

    files = [
        SetupFileReference(role="moldescriptor", name="moldescriptor.dat"),
        SetupFileReference(role="topology", name="topology.dat"),
        SetupFileReference(role="parameter", name="parameter.dat"),
    ]
    missing = validate_mm_setup_files(setup, files)
    assert any(item.code == "mm.file_missing.mshake" for item in missing)
    without = validate_mm_setup_files(_mm(), files + [
        SetupFileReference(role="mshake", name="mshake.dat")
    ])
    assert any(item.code == "mm.file_unused" for item in without)
