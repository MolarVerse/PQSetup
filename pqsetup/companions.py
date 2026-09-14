"""Bundled companion files for the water student path."""

from __future__ import annotations

from importlib import resources
from pathlib import Path

from .models import (
    SetupFile,
    SetupFileReference,
    SetupFileRole,
    SimulationSetup,
    Structure,
)
from .setup_files import QM_FILE_FIELDS

_SLAKOS_PLACEHOLDER = "__PQ_SLAKOS_3OB__"
SEEDABLE_ROLES: tuple[SetupFileRole, ...] = ("moldescriptor", "dftb_template")
DEFAULT_COMPANION_NAMES: dict[SetupFileRole, str] = {
    "moldescriptor": "moldescriptor.dat",
    "dftb_template": "dftb_in.template",
}
_WATER_ELEMENTS = frozenset({"H", "O"})


def example_text(name: str) -> str:
    return (
        resources.files("pqsetup.examples")
        .joinpath(name)
        .read_text(encoding="utf-8")
    )


def water_moldescriptor() -> str:
    return example_text("water_moldescriptor.dat")


def water_dftb_template(*, slakos_prefix: str | None = None) -> str:
    text = example_text("water_dftb_in.template")
    if slakos_prefix is None:
        return text
    prefix = str(Path(slakos_prefix).expanduser().resolve())
    if not prefix.endswith("/"):
        prefix += "/"
    return text.replace(_SLAKOS_PLACEHOLDER, prefix)


def discover_slakos_3ob(pq_executable: str | None) -> Path | None:
    if not pq_executable:
        return None
    root = Path(pq_executable).expanduser().resolve().parent
    candidates = (
        root.parent / "external" / "slakos" / "3ob" / "skfiles",
        root.parent.parent / "external" / "slakos" / "3ob" / "skfiles",
        root / "external" / "slakos" / "3ob" / "skfiles",
        root.parent / "share" / "PQ" / "slakos" / "3ob" / "skfiles",
    )
    for candidate in candidates:
        if (candidate / "H-H.skf").is_file() and (candidate / "O-H.skf").is_file():
            return candidate
    return None


def default_companion_name(role: SetupFileRole) -> str | None:
    return DEFAULT_COMPANION_NAMES.get(role)


def default_companion_content(
    role: SetupFileRole,
    *,
    pq_executable: str | None = None,
) -> str | None:
    if role == "moldescriptor":
        return water_moldescriptor()
    if role == "dftb_template":
        path = discover_slakos_3ob(pq_executable)
        if path is None:
            return None
        return water_dftb_template(slakos_prefix=str(path))
    return None


def structure_fits_water_companions(structure: Structure) -> bool:
    symbols = {atom.symbol for atom in structure.atoms}
    return bool(symbols) and symbols <= _WATER_ELEMENTS


# Keep old name used by api/tests
structure_fits_water_dftb = structure_fits_water_companions


def with_seeded_setup_references(
    setup: SimulationSetup,
    setup_files: list[SetupFileReference],
    roles_to_seed: list[SetupFileRole],
) -> tuple[SimulationSetup, list[SetupFileReference]]:
    """Add filename references for seedable roles that will be filled later."""
    by_role = {item.role: item for item in setup_files}
    setup_updates: dict[str, str] = {}
    refs = list(setup_files)
    for role in roles_to_seed:
        if role not in SEEDABLE_ROLES:
            continue
        field = QM_FILE_FIELDS[role]
        default_name = DEFAULT_COMPANION_NAMES[role]
        current_name = getattr(setup, field)
        name = current_name or default_name
        if current_name is None:
            setup_updates[field] = name
        if role not in by_role:
            refs.append(SetupFileReference(role=role, name=name))
    if setup_updates:
        setup = setup.model_copy(update=setup_updates)
    return setup, refs


def seedable_roles_for_structure(
    required_roles: list[SetupFileRole],
    structure: Structure | None,
) -> list[SetupFileRole]:
    roles = [role for role in required_roles if role in SEEDABLE_ROLES]
    if structure is not None and not structure_fits_water_companions(structure):
        return []
    return roles


def seed_missing_setup_files(
    setup: SimulationSetup,
    setup_files: list[SetupFile],
    roles_to_seed: list[SetupFileRole],
    *,
    pq_executable: str | None = None,
) -> list[SetupFile]:
    """Fill empty seedable companion files from the water examples."""
    by_role = {item.role: item for item in setup_files}
    seeded = list(setup_files)
    for role in roles_to_seed:
        if role not in SEEDABLE_ROLES:
            continue
        existing = by_role.get(role)
        if existing is not None and existing.content and existing.content.strip():
            continue
        content = default_companion_content(role, pq_executable=pq_executable)
        if content is None:
            continue
        name = getattr(setup, QM_FILE_FIELDS[role]) or DEFAULT_COMPANION_NAMES[role]
        replacement = SetupFile(role=role, name=name, content=content)
        if existing is None:
            seeded.append(replacement)
        else:
            seeded = [
                replacement if item.role == role else item for item in seeded
            ]
    return seeded


def role_needs_seed(
    role: SetupFileRole,
    setup_files: list[SetupFile],
) -> bool:
    existing = next((item for item in setup_files if item.role == role), None)
    return existing is None or not existing.content.strip()
