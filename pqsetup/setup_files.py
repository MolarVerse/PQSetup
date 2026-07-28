from __future__ import annotations

from pathlib import Path
from typing import Iterable

from .external_qm import selected_external_qm_script
from .models import (
    Diagnostic,
    ExternalQMCapabilities,
    SetupFileReference,
    SetupFileRole,
    SimulationSetup,
)


QM_FILE_FIELDS: dict[SetupFileRole, str] = {
    "moldescriptor": "moldescriptor_file",
    "dftb_template": "dftb_template_file",
    "turbomole_define_template": "turbomole_define_template_file",
}

QM_FILE_LABELS: dict[SetupFileRole, str] = {
    "moldescriptor": "Molecule descriptor",
    "dftb_template": "DFTB+ template",
    "turbomole_define_template": "Turbomole define template",
}

_FILE_KEYWORD_ROLES: dict[str, SetupFileRole] = {
    "dftb_file": "dftb_template",
}
_WORKING_FILE_ROLES: dict[str, SetupFileRole] = {
    "tm_define.template": "turbomole_define_template",
}


def required_qm_file_roles(
    setup: SimulationSetup,
    external_qm: ExternalQMCapabilities | None = None,
) -> tuple[SetupFileRole, ...]:
    if not setup.job_type.startswith("qm-"):
        return ()
    roles: list[SetupFileRole] = []
    if setup.ensemble == "NPT":
        roles.append("moldescriptor")
    script, _ = selected_external_qm_script(
        setup.runner,
        setup.runner_script,
        external_qm,
    )
    if script is not None:
        roles.extend(
            role
            for dependency in script.required_file_keywords
            if (role := _FILE_KEYWORD_ROLES.get(dependency)) is not None
        )
        roles.extend(
            role
            for dependency in script.required_working_files
            if (role := _WORKING_FILE_ROLES.get(dependency)) is not None
        )
    return tuple(dict.fromkeys(roles))


def required_qm_working_file_names(
    setup: SimulationSetup,
    external_qm: ExternalQMCapabilities | None = None,
) -> dict[SetupFileRole, str]:
    script, _ = selected_external_qm_script(
        setup.runner,
        setup.runner_script,
        external_qm,
    )
    if script is None:
        return {}
    return {
        role: dependency
        for dependency in script.required_working_files
        if (role := _WORKING_FILE_ROLES.get(dependency)) is not None
    }


def validate_qm_setup_files(
    setup: SimulationSetup,
    files: Iterable[SetupFileReference],
    external_qm: ExternalQMCapabilities | None = None,
) -> list[Diagnostic]:
    if not setup.job_type.startswith("qm-"):
        return []

    diagnostics: list[Diagnostic] = []
    required = set(required_qm_file_roles(setup, external_qm))
    working_file_names = required_qm_working_file_names(setup, external_qm)
    files_by_role: dict[SetupFileRole, SetupFileReference] = {}
    names: set[str] = set()
    for item in files:
        if item.role not in QM_FILE_FIELDS:
            diagnostics.append(
                _error(
                    "qm.file_unused",
                    f"'{item.name}' is not used by the selected QM setup.",
                )
            )
            continue
        diagnostics.extend(_filename_diagnostics(item.role, item.name))
        required_name = working_file_names.get(item.role)
        if required_name is not None and item.name != required_name:
            diagnostics.append(
                _error(
                    f"qm.file_required_name.{item.role}",
                    (
                        f"{QM_FILE_LABELS[item.role]} must be packaged as "
                        f"'{required_name}' for PQ."
                    ),
                )
            )
        if item.role in files_by_role:
            diagnostics.append(
                _error(
                    "qm.file_duplicate_role",
                    f"Choose only one {QM_FILE_LABELS[item.role].lower()} file.",
                )
            )
        else:
            files_by_role[item.role] = item
        folded_name = item.name.casefold()
        if folded_name in names:
            diagnostics.append(
                _error(
                    "qm.file_duplicate_name",
                    f"Setup files must have distinct names; '{item.name}' is reused.",
                )
            )
        names.add(folded_name)

        configured_name = getattr(setup, QM_FILE_FIELDS[item.role])
        if configured_name and configured_name != item.name:
            diagnostics.append(
                _error(
                    "qm.file_name_mismatch",
                    (
                        f"{QM_FILE_LABELS[item.role]} is named "
                        f"'{configured_name}' in the input but "
                        f"'{item.name}' was supplied."
                    ),
                )
            )

    for role in required:
        field_name = QM_FILE_FIELDS[role]
        configured_name = getattr(setup, field_name)
        if not configured_name:
            diagnostics.append(
                _error(
                    f"qm.{field_name}",
                    f"{QM_FILE_LABELS[role]} file is required.",
                )
            )
        elif (
            required_name := working_file_names.get(role)
        ) is not None and configured_name != required_name:
            diagnostics.append(
                _error(
                    f"qm.file_required_name.{role}",
                    (
                        f"{QM_FILE_LABELS[role]} must be named "
                        f"'{required_name}' for PQ."
                    ),
                )
            )
        elif role not in files_by_role:
            diagnostics.append(
                _error(
                    f"qm.file_missing.{role}",
                    f"Add the {QM_FILE_LABELS[role].lower()} file '{configured_name}'.",
                )
            )

    for role, item in files_by_role.items():
        if role not in required:
            diagnostics.append(
                _error(
                    "qm.file_unused",
                    f"'{item.name}' is not used by the selected QM setup.",
                )
            )
        elif not getattr(setup, QM_FILE_FIELDS[role]):
            diagnostics.append(
                _error(
                    f"qm.{QM_FILE_FIELDS[role]}",
                    f"Set the {QM_FILE_LABELS[role].lower()} filename.",
                )
            )
    script, _ = selected_external_qm_script(
        setup.runner,
        setup.runner_script,
        external_qm,
    )
    if script is not None:
        unsupported = [
            *(
                dependency
                for dependency in script.required_file_keywords
                if dependency not in _FILE_KEYWORD_ROLES
            ),
            *(
                dependency
                for dependency in script.required_working_files
                if dependency not in _WORKING_FILE_ROLES
            ),
        ]
        for dependency in unsupported:
            diagnostics.append(
                _error(
                    "qm.dependency_unsupported",
                    f"PQ requires companion file '{dependency}', which PQSetup cannot package.",
                )
            )
    return diagnostics


def _filename_diagnostics(
    role: SetupFileRole,
    name: str,
) -> list[Diagnostic]:
    field_name = QM_FILE_FIELDS[role]
    label = QM_FILE_LABELS[role]
    if not name:
        return [_error(f"qm.{field_name}", f"{label} filename is required.")]
    try:
        encoded_length = len(name.encode("utf-8"))
    except UnicodeEncodeError:
        return [_error(f"qm.{field_name}", f"{label} filename is invalid.")]
    if encoded_length > 255:
        return [_error(f"qm.{field_name}", f"{label} filename is too long.")]
    if Path(name).name != name:
        return [
            _error(
                f"qm.{field_name}",
                f"{label} must be a filename, not a path.",
            )
        ]
    if any(character in name for character in ";\n\r#\x00\\") or any(
        character.isspace() for character in name
    ):
        return [
            _error(
                f"qm.{field_name}",
                f"{label} filename contains an invalid character.",
            )
        ]
    return []


def _error(code: str, message: str) -> Diagnostic:
    return Diagnostic(code=code, severity="error", message=message)
