from __future__ import annotations

from pathlib import Path
from typing import Iterable

import numpy as np
from ase.data import atomic_masses, atomic_numbers

from .models import (
    Diagnostic,
    MMForceFieldMode,
    SetupFile,
    SetupFileReference,
    SetupFileRole,
    SimulationSetup,
    Structure,
)


MM_FILE_FIELDS: dict[SetupFileRole, str] = {
    "moldescriptor": "moldescriptor_file",
    "guff": "guff_file",
    "topology": "topology_file",
    "parameter": "parameter_file",
    "intra_nonbonded": "intra_nonbonded_file",
}

MM_MODE_LABELS: dict[MMForceFieldMode, str] = {
    "off": "Molecular mechanics · GUFF",
    "bonded": "Molecular mechanics · bonded + GUFF",
    "on": "Molecular mechanics · classical force field",
}

_REQUIRED_ROLES: dict[MMForceFieldMode, tuple[SetupFileRole, ...]] = {
    "off": ("moldescriptor", "guff"),
    "bonded": ("moldescriptor", "guff", "topology", "parameter"),
    "on": ("moldescriptor", "topology", "parameter"),
}

_ROLE_LABELS: dict[SetupFileRole, str] = {
    "moldescriptor": "Molecule descriptor",
    "guff": "GUFF parameters",
    "topology": "Topology",
    "parameter": "Force-field parameters",
    "intra_nonbonded": "Intramolecular nonbonded pairs",
}


def mm_method_label(mode: MMForceFieldMode) -> str:
    return MM_MODE_LABELS[mode]


def required_mm_file_roles(mode: MMForceFieldMode) -> tuple[SetupFileRole, ...]:
    return _REQUIRED_ROLES[mode]


def validate_mm_setup_files(
    setup: SimulationSetup,
    files: Iterable[SetupFileReference],
) -> list[Diagnostic]:
    if setup.job_type != "mm-md":
        return []

    diagnostics: list[Diagnostic] = []
    files_by_role: dict[SetupFileRole, SetupFileReference] = {}
    names: dict[str, SetupFileRole] = {}
    for item in files:
        diagnostics.extend(_filename_diagnostics(item.role, item.name))
        if item.role in files_by_role:
            diagnostics.append(
                _error(
                    "mm.file_duplicate_role",
                    f"Choose only one {_ROLE_LABELS[item.role].lower()} file.",
                )
            )
        else:
            files_by_role[item.role] = item

        folded_name = item.name.casefold()
        previous_role = names.get(folded_name)
        if folded_name and previous_role is not None and previous_role != item.role:
            diagnostics.append(
                _error(
                    "mm.file_duplicate_name",
                    f"Setup files must have distinct names; '{item.name}' is reused.",
                )
            )
        else:
            names[folded_name] = item.role

        configured_name = getattr(setup, MM_FILE_FIELDS[item.role])
        if configured_name and configured_name != item.name:
            diagnostics.append(
                _error(
                    "mm.file_name_mismatch",
                    (
                        f"{_ROLE_LABELS[item.role]} is named '{configured_name}' "
                        f"in the input but '{item.name}' was supplied."
                    ),
                )
            )

    required_roles = set(required_mm_file_roles(setup.mm_force_field))
    active_roles = set(required_roles)
    if setup.mm_force_field in {"bonded", "on"}:
        active_roles.add("intra_nonbonded")

    for role in required_roles:
        configured_name = getattr(setup, MM_FILE_FIELDS[role])
        if not configured_name:
            diagnostics.append(
                _error(
                    f"mm.{MM_FILE_FIELDS[role]}",
                    f"{_ROLE_LABELS[role]} file is required for this MM mode.",
                )
            )
        elif role not in files_by_role:
            diagnostics.append(
                _error(
                    f"mm.file_missing.{role}",
                    f"Add the {_ROLE_LABELS[role].lower()} file '{configured_name}'.",
                )
            )
    for role in active_roles - required_roles:
        configured_name = getattr(setup, MM_FILE_FIELDS[role])
        if configured_name and role not in files_by_role:
            diagnostics.append(
                _error(
                    f"mm.file_missing.{role}",
                    f"Add the {_ROLE_LABELS[role].lower()} file '{configured_name}'.",
                )
            )
    for role, item in files_by_role.items():
        configured_name = getattr(setup, MM_FILE_FIELDS[role])
        if role not in active_roles:
            diagnostics.append(
                _error(
                    "mm.file_unused",
                    f"'{item.name}' is not used by the selected MM mode.",
                )
            )
        elif not configured_name:
            diagnostics.append(
                _error(
                    f"mm.{MM_FILE_FIELDS[role]}",
                    f"Set the {_ROLE_LABELS[role].lower()} filename.",
                )
            )
    return diagnostics


def validate_mm_setup_contents(
    setup: SimulationSetup,
    structure: Structure,
    files: Iterable[SetupFile | SetupFileReference],
) -> list[Diagnostic]:
    if setup.job_type != "mm-md":
        return []
    descriptor = next(
        (
            item
            for item in files
            if item.role == "moldescriptor"
            and getattr(item, "content", None) is not None
        ),
        None,
    )
    if descriptor is None:
        return []
    content = getattr(descriptor, "content", None)
    if not isinstance(content, str):
        return []
    try:
        molecule_sizes = _parse_moldescriptor(
            content,
            require_global_vdw=setup.mm_force_field == "on",
        )
    except ValueError as error:
        return [_error("mm.moldescriptor_content", str(error))]

    diagnostics: list[Diagnostic] = []
    atom_index = 0
    atoms = structure.atoms
    while atom_index < len(atoms):
        molecule_type = atoms[atom_index].molecule_type
        if molecule_type <= 0:
            diagnostics.append(
                Diagnostic(
                    code="mm.structure_molecule_types",
                    severity="error",
                    message=(
                        "Every atom in an MM restart needs a positive molecule "
                        "type."
                    ),
                    atom_indices=[atom_index],
                )
            )
            break
        if molecule_type > len(molecule_sizes):
            diagnostics.append(
                Diagnostic(
                    code="mm.structure_molecule_types",
                    severity="error",
                    message=(
                        f"Molecule type {molecule_type} is not defined in "
                        f"'{descriptor.name}'."
                    ),
                    atom_indices=[atom_index],
                )
            )
            break
        molecule_size = molecule_sizes[molecule_type - 1]
        end = atom_index + molecule_size
        if end > len(atoms) or any(
            atom.molecule_type != molecule_type for atom in atoms[atom_index:end]
        ):
            diagnostics.append(
                Diagnostic(
                    code="mm.structure_molecule_layout",
                    severity="error",
                    message=(
                        f"Molecule type {molecule_type} must contain "
                        f"{molecule_size} consecutive atoms, matching "
                        f"'{descriptor.name}'."
                    ),
                    atom_indices=list(range(atom_index, min(end, len(atoms)))),
                )
            )
            break
        atom_index = end
    return diagnostics


def validate_mm_structure(
    setup: SimulationSetup,
    structure: Structure,
) -> list[Diagnostic]:
    if setup.job_type != "mm-md":
        return []

    diagnostics: list[Diagnostic] = []
    invalid_molecule_types = [
        index
        for index, atom in enumerate(structure.atoms)
        if atom.molecule_type <= 0
    ]
    if invalid_molecule_types:
        diagnostics.append(
            Diagnostic(
                code="mm.structure_molecule_types",
                severity="error",
                message=(
                    "Every atom in an MM restart needs a positive molecule "
                    "type."
                ),
                atom_indices=invalid_molecule_types,
            )
        )
    if structure.cell_generated and not _positive_finite(setup.density_g_cm3):
        diagnostics.append(
            _error(
                "mm.density",
                (
                    "Set the material density for molecular mechanics when the "
                    "imported structure has no physical cell."
                ),
            )
        )
    shortest_span = _shortest_periodic_span(setup, structure)
    if (
        shortest_span is not None
        and setup.coulomb_cutoff_angstrom >= shortest_span / 2.0
    ):
        maximum = shortest_span / 2.0
        source = (
            "density-derived box"
            if structure.cell_generated
            else "shortest periodic span"
        )
        diagnostics.append(
            _error(
                "mm.coulomb_cutoff_box",
                (
                    f"Coulomb cutoff {setup.coulomb_cutoff_angstrom:.4g} Å must "
                    f"be below {maximum:.4g} Å for the {source}. Use a larger "
                    "system or a smaller cutoff."
                ),
            )
        )
    return diagnostics


def _filename_diagnostics(
    role: SetupFileRole,
    name: str,
) -> list[Diagnostic]:
    label = _ROLE_LABELS[role]
    if not name:
        return [_error(f"mm.{MM_FILE_FIELDS[role]}", f"{label} filename is required.")]
    if len(name) > 255:
        return [_error(f"mm.{MM_FILE_FIELDS[role]}", f"{label} filename is too long.")]
    if Path(name).name != name:
        return [
            _error(
                f"mm.{MM_FILE_FIELDS[role]}",
                f"{label} must be a filename, not a path.",
            )
        ]
    if any(character in name for character in ";\n\r#\x00\\") or any(
        character.isspace() for character in name
    ):
        return [
            _error(
                f"mm.{MM_FILE_FIELDS[role]}",
                f"{label} filename contains an invalid character.",
            )
        ]
    return []


def _parse_moldescriptor(
    content: str,
    *,
    require_global_vdw: bool,
) -> list[int]:
    lines = [
        (line_number, raw_line.split("#", 1)[0].split())
        for line_number, raw_line in enumerate(content.splitlines(), start=1)
    ]
    molecule_sizes: list[int] = []
    index = 0
    while index < len(lines):
        line_number, fields = lines[index]
        index += 1
        if not fields:
            continue
        keyword = fields[0].replace("-", "_").lower()
        if keyword in {"water_type", "ammonia_type"}:
            if len(fields) < 2:
                raise ValueError(
                    f"Molecule descriptor line {line_number} needs a type index."
                )
            try:
                int(fields[1])
            except ValueError as error:
                raise ValueError(
                    f"Molecule descriptor line {line_number} has an invalid type index."
                ) from error
            continue
        if len(fields) < 3:
            raise ValueError(
                f"Molecule descriptor line {line_number} needs name, atom count, and charge."
            )
        try:
            atom_count = int(fields[1])
            float(fields[2])
        except ValueError as error:
            raise ValueError(
                f"Molecule descriptor line {line_number} has an invalid header."
            ) from error
        if atom_count <= 0:
            raise ValueError(
                f"Molecule descriptor line {line_number} needs a positive atom count."
            )
        atoms_read = 0
        while atoms_read < atom_count and index < len(lines):
            atom_line, atom_fields = lines[index]
            index += 1
            if not atom_fields:
                continue
            expected_fields = 4 if require_global_vdw else 3
            if len(atom_fields) not in ({4} if require_global_vdw else {3, 4}):
                raise ValueError(
                    f"Molecule descriptor atom line {atom_line} needs "
                    f"{expected_fields} fields."
                )
            try:
                int(atom_fields[1])
                float(atom_fields[2])
                if require_global_vdw:
                    int(atom_fields[3])
            except ValueError as error:
                raise ValueError(
                    f"Molecule descriptor atom line {atom_line} has an invalid value."
                ) from error
            atoms_read += 1
        if atoms_read != atom_count:
            raise ValueError(
                f"Molecule descriptor type {len(molecule_sizes) + 1} ends before "
                f"its {atom_count} atoms are defined."
            )
        molecule_sizes.append(atom_count)
    if not molecule_sizes:
        raise ValueError("Molecule descriptor does not define any molecule types.")
    return molecule_sizes


def _positive_finite(value: float | None) -> bool:
    return value is not None and np.isfinite(value) and value > 0.0


def _shortest_periodic_span(
    setup: SimulationSetup,
    structure: Structure,
) -> float | None:
    if structure.cell_generated:
        if not _positive_finite(setup.density_g_cm3):
            return None
        mass_amu = sum(
            float(atomic_masses[atomic_numbers[atom.symbol]])
            for atom in structure.atoms
        )
        volume_angstrom3 = mass_amu * 1.66053906660 / setup.density_g_cm3
        return volume_angstrom3 ** (1.0 / 3.0)

    if structure.cell is None:
        return None
    cell = np.asarray(structure.cell, dtype=float)
    if cell.shape != (3, 3) or not np.isfinite(cell).all():
        return None
    volume = abs(float(np.linalg.det(cell)))
    if volume <= 0.0:
        return None
    heights: list[float] = []
    for index in range(3):
        other = [axis for axis in range(3) if axis != index]
        face_area = float(np.linalg.norm(np.cross(cell[other[0]], cell[other[1]])))
        if face_area <= 0.0:
            return None
        heights.append(volume / face_area)
    return min(heights)


def _error(code: str, message: str) -> Diagnostic:
    return Diagnostic(code=code, severity="error", message=message)
