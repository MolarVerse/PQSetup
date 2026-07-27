from __future__ import annotations

import numpy as np
import pytest

from pqsetup.collisions import DEFAULT_SAMPLE_LIMIT, scan_collisions
from pqsetup.models import Atom, Structure
from pqsetup.structures import analyze_structure


def test_nonperiodic_collision() -> None:
    structure = Structure(
        atoms=[
            Atom(symbol="C", position=(0.0, 0.0, 0.0)),
            Atom(symbol="C", position=(0.2, 0.0, 0.0)),
        ]
    )

    result = scan_collisions(structure)

    assert not result.truncated
    assert len(result.collisions) == 1
    assert result.collisions[0].distance_angstrom == pytest.approx(0.2)
    assert result.collisions[0].severity == "error"


def test_orthorhombic_minimum_image() -> None:
    structure = Structure(
        atoms=[
            Atom(symbol="C", position=(-4.9, 0.0, 0.0)),
            Atom(symbol="C", position=(4.9, 0.0, 0.0)),
        ],
        cell=[
            (10.0, 0.0, 0.0),
            (0.0, 10.0, 0.0),
            (0.0, 0.0, 10.0),
        ],
        periodic=(True, True, True),
    )

    result = scan_collisions(structure)

    assert not result.truncated
    assert len(result.collisions) == 1
    assert result.collisions[0].distance_angstrom == pytest.approx(0.2)


def test_orthorhombic_self_image_collision() -> None:
    structure = Structure(
        atoms=[Atom(symbol="C", position=(0.0, 0.0, 0.0))],
        cell=[
            (0.2, 0.0, 0.0),
            (0.0, 10.0, 0.0),
            (0.0, 0.0, 10.0),
        ],
        periodic=(True, True, True),
    )

    result = scan_collisions(structure)

    assert not result.truncated
    assert len(result.collisions) == 1
    assert result.collisions[0].atom_i == result.collisions[0].atom_j == 0
    assert result.collisions[0].distance_angstrom == pytest.approx(0.2)


def test_triclinic_minimum_image() -> None:
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

    result = scan_collisions(structure)

    expected = np.linalg.norm(np.asarray((-0.02, -0.02, 0.0)) @ cell)
    assert not result.truncated
    assert len(result.collisions) == 1
    assert result.collisions[0].distance_angstrom == pytest.approx(expected)


def test_coincident_atoms_are_bounded() -> None:
    atom_count = 10_000
    structure = Structure(
        atoms=[Atom(symbol="C", position=(0.0, 0.0, 0.0)) for _ in range(atom_count)],
        cell=[
            (20.0, 0.0, 0.0),
            (0.0, 20.0, 0.0),
            (0.0, 0.0, 20.0),
        ],
        periodic=(True, True, True),
    )

    result = scan_collisions(structure)
    analysis = analyze_structure(structure)

    assert result.truncated
    assert len(result.collisions) == DEFAULT_SAMPLE_LIMIT
    assert all(item.distance_angstrom == 0.0 for item in result.collisions)
    assert not analysis.valid
    assert analysis.collisions_truncated
    assert len(analysis.collisions) == DEFAULT_SAMPLE_LIMIT
    assert "structure.contact_limit" in {item.code for item in analysis.diagnostics}


def test_custom_limit_and_invalid_limit() -> None:
    structure = Structure(
        atoms=[
            Atom(symbol="H", position=(0.0, 0.0, 0.0)),
            Atom(symbol="H", position=(0.0, 0.0, 0.0)),
            Atom(symbol="H", position=(0.0, 0.0, 0.0)),
        ]
    )

    result = scan_collisions(structure, sample_limit=2)

    assert result.truncated
    assert len(result.collisions) == 2
    with pytest.raises(ValueError, match="positive"):
        scan_collisions(structure, sample_limit=0)
