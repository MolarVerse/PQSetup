from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from .models import (
    ExternalQMCapabilities,
    ExternalQMProgram,
    ExternalQMScript,
)


FALLBACK_EXTERNAL_QM = ExternalQMCapabilities.model_validate(
    {
        "script_mode": "bundled_or_full_path",
        "programs": {
            "dftbplus": {
                "recommended_script": "dftbplus_periodic_stress",
                "scripts": [
                    {
                        "name": "dftbplus_periodic_stress",
                        "label": "DFTB+ periodic stress",
                        "required_file_keywords": ["dftb_file"],
                    }
                ],
            },
            "pyscf": {
                "recommended_script": None,
                "scripts": [
                    {"name": "pyscf_hf.py", "label": "UHF / STO-3G"},
                    {
                        "name": "pyscf_mp2.py",
                        "label": "UMP2 / 6-311++G**",
                    },
                ],
            },
            "turbomole": {
                "recommended_script": "turbomole_rimp2",
                "scripts": [
                    {
                        "name": "turbomole_rimp2",
                        "label": "RI-MP2",
                        "required_working_files": ["tm_define.template"],
                    }
                ],
            },
        },
    }
)


def parse_external_qm(
    capabilities: dict[str, Any] | None,
) -> ExternalQMCapabilities | None:
    if capabilities is None:
        return None
    input_capabilities = capabilities.get("input")
    if not isinstance(input_capabilities, dict):
        return None
    payload = input_capabilities.get("external_qm")
    if not isinstance(payload, dict):
        return None
    try:
        return ExternalQMCapabilities.model_validate(payload)
    except ValidationError:
        return None


def external_qm_config(
    capabilities: ExternalQMCapabilities | None,
) -> ExternalQMCapabilities:
    return capabilities or FALLBACK_EXTERNAL_QM


def external_qm_program(
    runner: str | None,
    capabilities: ExternalQMCapabilities | None,
) -> ExternalQMProgram | None:
    if runner is None:
        return None
    return external_qm_config(capabilities).programs.get(runner)


def selected_external_qm_script(
    runner: str | None,
    selected: str | None,
    capabilities: ExternalQMCapabilities | None,
) -> tuple[ExternalQMScript | None, str | None]:
    program = external_qm_program(runner, capabilities)
    if program is None:
        return None, None

    script_name = selected or program.recommended_script
    if script_name is None:
        return None, "Choose an electronic method for the selected calculator."
    script = next(
        (candidate for candidate in program.scripts if candidate.name == script_name),
        None,
    )
    if script is None:
        return None, (
            "The selected electronic method is not supported by this PQ installation."
        )
    return script, None


def advertised_script_names(
    capabilities: ExternalQMCapabilities | None,
) -> dict[str, tuple[str, ...]]:
    config = external_qm_config(capabilities)
    return {
        runner: tuple(script.name for script in program.scripts)
        for runner, program in config.programs.items()
    }
