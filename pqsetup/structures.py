from __future__ import annotations

import math
import tempfile
from collections.abc import Iterable
from hashlib import sha256
from itertools import combinations
from pathlib import Path

import numpy as np
from ase import Atoms
from ase.cell import Cell
from ase.data import atomic_masses, atomic_numbers
from ase.geometry import cellpar_to_cell
from ase.io import read
from ase.io.formats import UnknownFileTypeError

from .collisions import scan_collisions
from .models import (
    Atom,
    Collision,
    Diagnostic,
    PerturbationResult,
    Structure,
    StructureAnalysis,
    StructureSummary,
)

_VACUUM_PADDING_ANGSTROM = 6.0


def parse_structure_bytes(filename: str, content: bytes) -> Structure:
    suffix = Path(filename).suffix.lower()
    if suffix == ".rst":
        return parse_pq_restart(content.decode("utf-8"), filename)
    try:
        with tempfile.TemporaryDirectory() as directory:
            temporary_path = Path(directory) / (Path(filename).name or "structure")
            temporary_path.write_bytes(content)
            ase_atoms = read(temporary_path, index=-1)
    except UnknownFileTypeError as error:
        label = suffix or "without an extension"
        raise ValueError(f"Unsupported structure format {label}.") from error
    except (EOFError, IndexError, OSError, StopIteration) as error:
        raise ValueError("The structure file is empty or incomplete.") from error
    if not isinstance(ase_atoms, Atoms):
        raise ValueError("The file does not contain an atomic structure.")
    return structure_from_ase(ase_atoms, filename, suffix.lstrip("."))


def parse_pq_restart(text: str, filename: str | None = None) -> Structure:
    atoms: list[Atom] = []
    cell: list[tuple[float, float, float]] | None = None
    periodic = (False, False, False)
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        fields = line.split()
        section = fields[0].lower()
        if section in {"step", "chi"}:
            continue
        if section == "box":
            if len(fields) not in {4, 7}:
                raise ValueError(f"Invalid Box section on line {line_number}.")
            values = [_finite_float(value, line_number) for value in fields[1:]]
            lengths = values[:3]
            angles = values[3:] if len(values) == 6 else [90.0] * 3
            if any(length <= 0.0 for length in lengths):
                raise ValueError("Cell lengths must be positive.")
            if any(angle <= 0.0 or angle >= 180.0 for angle in angles):
                raise ValueError("Cell angles must be between 0 and 180°.")
            vectors = cellpar_to_cell([*lengths, *angles])
            cell = _matrix(vectors)
            periodic = (True, True, True)
            continue
        if len(fields) not in {6, 9, 12, 15, 18, 21}:
            raise ValueError(f"Invalid atom record on line {line_number}.")
        symbol = fields[0]
        if symbol not in atomic_numbers:
            raise ValueError(f"Unknown element '{symbol}' on line {line_number}.")
        try:
            molecule_type = int(fields[2])
        except ValueError as error:
            raise ValueError(f"Invalid molecule type on line {line_number}.") from error
        numeric = [_finite_float(value, line_number) for value in fields[3:]]
        atoms.append(
            Atom(
                symbol=symbol,
                position=_vector3(numeric[:3]),
                molecule_type=molecule_type,
                velocity=_vector3(numeric[3:6]) if len(numeric) >= 6 else None,
                force=_vector3(numeric[6:9]) if len(numeric) >= 9 else None,
            )
        )
    if not atoms:
        raise ValueError("The restart file contains no atoms.")
    structure = Structure(
        atoms=atoms,
        cell=cell,
        periodic=periodic,
        source_name=filename,
        source_format="pq-restart",
    )
    return ensure_pq_cell(structure)


def structure_from_ase(
    atoms: Atoms,
    filename: str | None = None,
    source_format: str | None = None,
) -> Structure:
    if not np.isfinite(atoms.positions).all():
        raise ValueError("All coordinates must be finite.")
    if atoms.cell.rank and not np.isfinite(atoms.cell.array).all():
        raise ValueError("All cell vectors must be finite.")
    cell = _matrix(atoms.cell.array) if atoms.cell.rank == 3 else None
    structure = Structure(
        atoms=[
            Atom(
                symbol=symbol,
                position=_vector3(position),
            )
            for symbol, position in zip(
                atoms.get_chemical_symbols(), atoms.positions, strict=True
            )
        ],
        cell=cell,
        periodic=(
            bool(atoms.pbc[0]),
            bool(atoms.pbc[1]),
            bool(atoms.pbc[2]),
        ),
        source_name=filename,
        source_format=source_format,
    )
    return ensure_pq_cell(structure)


def ensure_pq_cell(
    structure: Structure,
    padding_angstrom: float = _VACUUM_PADDING_ANGSTROM,
) -> Structure:
    result = structure.model_copy(deep=True)
    if result.cell is not None:
        result.periodic = (True, True, True)
        return wrap_centered(result)
    if not result.atoms:
        return result
    positions = np.asarray([atom.position for atom in result.atoms], dtype=float)
    center = (positions.min(axis=0) + positions.max(axis=0)) / 2.0
    lengths = np.maximum(
        positions.max(axis=0) - positions.min(axis=0) + 2.0 * padding_angstrom,
        2.0 * padding_angstrom,
    )
    for atom, position in zip(result.atoms, positions - center, strict=True):
        atom.position = _vector3(position)
    result.cell = _matrix(np.diag(lengths))
    result.periodic = (True, True, True)
    result.cell_generated = True
    result.cell_padding_angstrom = padding_angstrom
    return wrap_centered(result)


def wrap_centered(structure: Structure) -> Structure:
    if structure.cell is None or not any(structure.periodic):
        return structure.model_copy(deep=True)
    cell = np.asarray(structure.cell, dtype=float)
    if (
        cell.shape != (3, 3)
        or not np.isfinite(cell).all()
        or abs(np.linalg.det(cell)) < 1e-12
    ):
        return structure.model_copy(deep=True)
    inverse = np.linalg.inv(cell)
    result = structure.model_copy(deep=True)
    for atom in result.atoms:
        fractional = np.asarray(atom.position, dtype=float) @ inverse
        for axis, periodic in enumerate(result.periodic):
            if periodic:
                fractional[axis] = ((fractional[axis] + 0.5) % 1.0) - 0.5
        position = fractional @ cell
        atom.position = _vector3(position)
    result.wrapped_centered = True
    return result


def analyze_structure(structure: Structure) -> StructureAnalysis:
    diagnostics: list[Diagnostic] = []
    symbols = [atom.symbol for atom in structure.atoms]
    positions = np.asarray([atom.position for atom in structure.atoms])

    if not structure.atoms:
        diagnostics.append(
            Diagnostic(
                code="structure.empty",
                severity="error",
                message="The structure contains no atoms.",
            )
        )
    invalid_symbols = [
        index for index, symbol in enumerate(symbols) if symbol not in atomic_numbers
    ]
    if invalid_symbols:
        diagnostics.append(
            Diagnostic(
                code="structure.unknown_elements",
                severity="error",
                message="The structure contains unknown elements.",
                atom_indices=invalid_symbols,
            )
        )
    invalid_positions = (
        np.flatnonzero(~np.isfinite(positions).all(axis=1)).tolist()
        if positions.size
        else []
    )
    if invalid_positions:
        diagnostics.append(
            Diagnostic(
                code="structure.non_finite_coordinates",
                severity="error",
                message="All coordinates must be finite.",
                atom_indices=invalid_positions,
            )
        )

    molecule_type_indices = [
        index for index, atom in enumerate(structure.atoms) if atom.molecule_type != 0
    ]
    if molecule_type_indices:
        diagnostics.append(
            Diagnostic(
                code="structure.molecule_types",
                severity="error",
                message=(
                    "Non-zero molecule types need moldescriptor.dat, which "
                    "guided packages do not include yet."
                ),
                atom_indices=molecule_type_indices,
            )
        )

    volume: float | None = None
    cell_valid = structure.cell is not None
    if structure.cell is not None:
        matrix = np.asarray(structure.cell, dtype=float)
        if matrix.shape != (3, 3):
            cell_valid = False
            diagnostics.append(
                Diagnostic(
                    code="cell.shape",
                    severity="error",
                    message="The cell must contain three vectors.",
                )
            )
        elif not np.isfinite(matrix).all():
            cell_valid = False
            diagnostics.append(
                Diagnostic(
                    code="cell.non_finite",
                    severity="error",
                    message="All cell vectors must be finite.",
                )
            )
        elif abs(float(np.linalg.det(matrix))) < 1e-9:
            cell_valid = False
            diagnostics.append(
                Diagnostic(
                    code="cell.singular",
                    severity="error",
                    message="The periodic cell must have a non-zero volume.",
                )
            )
        else:
            volume = abs(float(np.linalg.det(matrix)))
    else:
        cell_valid = False
        diagnostics.append(
            Diagnostic(
                code="cell.missing",
                severity="error",
                message="PQ molecular dynamics needs a three-dimensional cell.",
            )
        )
    if structure.cell is not None and not all(structure.periodic):
        cell_valid = False
        diagnostics.append(
            Diagnostic(
                code="cell.periodicity",
                severity="error",
                message="PQ molecular dynamics needs three-dimensional periodicity.",
            )
        )
    if structure.cell_generated:
        diagnostics.append(
            Diagnostic(
                code="structure.cell_generated",
                severity="info",
                message=(
                    "Added a centered vacuum cell with "
                    f"{_number(structure.cell_padding_angstrom or 0.0)} Å padding."
                ),
            )
        )

    collisions: list[Collision] = []
    collisions_truncated = False
    minimum_distance: float | None = None
    can_measure = (
        bool(structure.atoms)
        and not invalid_symbols
        and not invalid_positions
        and (not any(structure.periodic) or cell_valid)
    )
    if can_measure:
        collision_scan = scan_collisions(structure)
        collisions = collision_scan.collisions
        collisions_truncated = collision_scan.truncated
        minimum_distance = _minimum_distance(structure)
        hard = [item for item in collisions if item.severity == "error"]
        short = [item for item in collisions if item.severity == "warning"]
        if hard:
            indices = sorted(
                {index for item in hard for index in (item.atom_i, item.atom_j)}
            )
            diagnostics.append(
                Diagnostic(
                    code="structure.collision",
                    severity="error",
                    message=f"{len(hard)} atomic collision(s) detected.",
                    atom_indices=indices,
                )
            )
        if collisions_truncated:
            diagnostics.append(
                Diagnostic(
                    code="structure.contact_limit",
                    severity="error",
                    message=(
                        "More than 200 short contacts found. Fix the structure "
                        "before continuing."
                    ),
                    atom_indices=sorted(
                        {
                            index
                            for item in collisions
                            for index in (item.atom_i, item.atom_j)
                        }
                    ),
                )
            )
        if short:
            indices = sorted(
                {index for item in short for index in (item.atom_i, item.atom_j)}
            )
            diagnostics.append(
                Diagnostic(
                    code="structure.short_contacts",
                    severity="warning",
                    message=f"{len(short)} unusually short contact(s) detected.",
                    atom_indices=indices,
                )
            )

    formula = (
        Atoms(symbols=symbols).get_chemical_formula(mode="hill")
        if symbols and not invalid_symbols
        else ""
    )
    density = None
    if volume and symbols and not invalid_symbols:
        mass_amu = sum(atomic_masses[atomic_numbers[symbol]] for symbol in symbols)
        density = float(mass_amu * 1.66053906660 / volume)
    valid = not any(item.severity == "error" for item in diagnostics)
    return StructureAnalysis(
        structure=structure,
        summary=StructureSummary(
            atom_count=len(structure.atoms),
            formula=formula,
            volume_angstrom3=volume,
            density_g_cm3=density,
            minimum_distance_angstrom=minimum_distance,
        ),
        diagnostics=diagnostics,
        collisions=collisions,
        collisions_truncated=collisions_truncated,
        valid=valid,
    )


def find_collisions(structure: Structure) -> list[Collision]:
    return scan_collisions(structure).collisions


def perturb_structure(
    structure: Structure,
    sigma_angstrom: float,
    seed: int,
) -> PerturbationResult:
    if not math.isfinite(sigma_angstrom) or sigma_angstrom < 0.0:
        raise ValueError("Position sigma must be finite and non-negative.")
    if seed < 0 or seed > 4_294_967_295:
        raise ValueError("Random seed must be between 0 and 4294967295.")
    source_content = format_pq_restart(structure)
    result = structure.model_copy(deep=True)
    if result.atoms and sigma_angstrom:
        generator = np.random.default_rng(seed)
        displacement = generator.normal(
            loc=0.0,
            scale=sigma_angstrom,
            size=(len(result.atoms), 3),
        )
        displacement -= displacement.mean(axis=0)
        for atom, offset in zip(result.atoms, displacement, strict=True):
            atom.position = _vector3(np.asarray(atom.position, dtype=float) + offset)
    for atom in result.atoms:
        atom.velocity = None
        atom.force = None
    result = wrap_centered(result)
    analysis = analyze_structure(result)
    analysis.diagnostics.append(
        Diagnostic(
            code="structure.velocities_regenerated",
            severity="info",
            message="Velocities will be initialized by PQ at the target temperature.",
        )
    )
    filename = _prepared_filename(structure.source_name)
    restart_content = format_pq_restart(result)
    return PerturbationResult(
        **analysis.model_dump(),
        sigma_angstrom=sigma_angstrom,
        seed=seed,
        source_sha256=sha256(source_content.encode("utf-8")).hexdigest(),
        prepared_sha256=sha256(restart_content.encode("utf-8")).hexdigest(),
        restart_filename=filename,
        restart_content=restart_content,
    )


def format_pq_restart(structure: Structure) -> str:
    lines = ["Step 0"]
    if structure.cell is not None:
        cell_parameters = Cell(structure.cell).cellpar()
        values = " ".join(_number(value) for value in cell_parameters)
        lines.append(f"Box {values}")
    for index, atom in enumerate(structure.atoms, start=1):
        coordinates = " ".join(_number(value) for value in atom.position)
        values = f"{atom.symbol} {index} {atom.molecule_type} {coordinates}"
        if atom.velocity is not None:
            values += " " + " ".join(_number(value) for value in atom.velocity)
        if atom.force is not None:
            velocity = atom.velocity or (0.0, 0.0, 0.0)
            if atom.velocity is None:
                values += " " + " ".join(_number(value) for value in velocity)
            values += " " + " ".join(_number(value) for value in atom.force)
        lines.append(values)
    return "\n".join(lines) + "\n"


def _minimum_distance(structure: Structure) -> float | None:
    if len(structure.atoms) < 2:
        return None
    atoms = Atoms(
        symbols=[atom.symbol for atom in structure.atoms],
        positions=[atom.position for atom in structure.atoms],
        cell=structure.cell or np.zeros((3, 3)),
        pbc=structure.periodic,
    )
    if len(atoms) <= 2000:
        distances = atoms.get_all_distances(mic=any(structure.periodic))
        return float(
            min(distances[i, j] for i, j in combinations(range(len(atoms)), 2))
        )
    return None


def _prepared_filename(source_name: str | None) -> str:
    stem = Path(source_name).stem if source_name else "structure"
    return f"{stem}-prepared.rst"


def _finite_float(value: str, line_number: int) -> float:
    try:
        parsed = float(value)
    except ValueError as error:
        raise ValueError(f"Invalid number on line {line_number}.") from error
    if not math.isfinite(parsed):
        raise ValueError(f"Non-finite number on line {line_number}.")
    return parsed


def _matrix(values: np.ndarray) -> list[tuple[float, float, float]]:
    return [_vector3(vector) for vector in np.asarray(values)]


def _vector3(values: Iterable[float]) -> tuple[float, float, float]:
    vector = [float(value) for value in values]
    if len(vector) != 3:
        raise ValueError("Expected a three-dimensional vector.")
    return (vector[0], vector[1], vector[2])


def _number(value: float) -> str:
    return f"{float(value):.10g}"
