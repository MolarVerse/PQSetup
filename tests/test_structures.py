from __future__ import annotations

from hashlib import sha256
from pathlib import Path

import numpy as np

from pqsetup.models import Atom, Structure
from pqsetup.structures import (
    analyze_structure,
    format_pq_restart,
    parse_structure_bytes,
    perturb_structure,
)


DATA = Path(__file__).parent / "data"


def load(name: str) -> Structure:
    path = DATA / name
    return parse_structure_bytes(path.name, path.read_bytes())


def test_reads_pq_restart_and_ase_xyz() -> None:
    restart = load("water.rst")
    xyz = load("water.xyz")

    assert len(restart.atoms) == 3
    assert restart.periodic == (True, True, True)
    assert restart.wrapped_centered
    assert len(xyz.atoms) == 3
    assert xyz.source_format == "xyz"
    assert xyz.periodic == (True, True, True)
    assert xyz.cell_generated
    assert xyz.cell_padding_angstrom == 6.0
    positions = np.asarray([atom.position for atom in xyz.atoms])
    assert np.allclose(positions.min(axis=0) + positions.max(axis=0), 0.0)


def test_reads_legacy_restart_width_and_preserves_current_vectors() -> None:
    structure = load("legacy.rst")

    assert structure.atoms[0].velocity == (1.0, 2.0, 3.0)
    assert structure.atoms[0].force == (4.0, 5.0, 6.0)
    text = format_pq_restart(structure)
    assert "1 2 3 4 5 6" in text


def test_periodic_collision_across_centered_cell_boundary() -> None:
    structure = Structure(
        atoms=[
            Atom(symbol="C", position=(-4.9, 0.0, 0.0)),
            Atom(symbol="C", position=(4.9, 0.0, 0.0)),
        ],
        cell=[(10.0, 0.0, 0.0), (0.0, 10.0, 0.0), (0.0, 0.0, 10.0)],
        periodic=(True, True, True),
    )

    result = analyze_structure(structure)

    assert not result.valid
    assert len(result.collisions) == 1
    assert result.collisions[0].distance_angstrom == pytest_approx(0.2)
    assert result.collisions[0].severity == "error"


def test_triclinic_minimum_image_collision() -> None:
    cell = np.asarray([(5.0, 0.0, 0.0), (2.0, 4.0, 0.0), (0.0, 0.0, 5.0)])
    first = np.asarray((-0.49, -0.49, 0.0)) @ cell
    second = np.asarray((0.49, 0.49, 0.0)) @ cell
    structure = Structure(
        atoms=[
            Atom(symbol="C", position=tuple(first)),
            Atom(symbol="C", position=tuple(second)),
        ],
        cell=[tuple(vector) for vector in cell],
        periodic=(True, True, True),
    )

    result = analyze_structure(structure)

    assert not result.valid
    assert len(result.collisions) == 1
    assert result.collisions[0].distance_angstrom == pytest_approx(
        np.linalg.norm(np.asarray((-0.02, -0.02, 0.0)) @ cell)
    )


def test_invalid_cell_shape_is_a_diagnostic_not_an_exception() -> None:
    structure = Structure(
        atoms=[Atom(symbol="C", position=(0.0, 0.0, 0.0))],
        cell=[(1.0, 0.0, 0.0), (0.0, 1.0, 0.0)],
        periodic=(True, True, True),
    )

    result = analyze_structure(structure)

    assert not result.valid
    assert result.diagnostics[0].code == "cell.shape"


def test_nonzero_molecule_types_require_companion_metadata() -> None:
    structure = load("water.rst")
    structure.atoms[0].molecule_type = 1

    result = analyze_structure(structure)

    assert not result.valid
    assert "structure.molecule_types" in {item.code for item in result.diagnostics}


def test_perturbation_is_reproducible_centered_and_non_destructive() -> None:
    original = load("legacy.rst")
    positions = np.asarray([atom.position for atom in original.atoms])

    first = perturb_structure(original, 0.02, 1234)
    second = perturb_structure(original, 0.02, 1234)
    perturbed = np.asarray([atom.position for atom in first.structure.atoms])

    assert [atom.position for atom in first.structure.atoms] == [
        atom.position for atom in second.structure.atoms
    ]
    assert np.allclose((perturbed - positions).mean(axis=0), 0.0)
    assert [atom.position for atom in original.atoms] == [
        tuple(row) for row in positions
    ]
    assert all(atom.velocity is None for atom in first.structure.atoms)
    assert all(atom.force is None for atom in first.structure.atoms)
    assert "structure.velocities_regenerated" in {
        item.code for item in first.diagnostics
    }
    assert len(first.restart_content.splitlines()[2].split()) == 6
    assert first.source_sha256 == second.source_sha256
    assert first.prepared_sha256 == second.prepared_sha256
    assert (
        first.prepared_sha256
        == sha256(first.restart_content.encode("utf-8")).hexdigest()
    )


def pytest_approx(value: float):
    import pytest

    return pytest.approx(value, abs=1e-9)
