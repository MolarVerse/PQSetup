from __future__ import annotations

import re
from typing import Literal

from .input_writer import render_input, restart_filename
from .models import (
    CalculatorSelection,
    Diagnostic,
    EquilibrationStage,
    PlannedInput,
    PlanRenderResult,
    PQStatus,
    RunnerStatus,
    RunPlanRequest,
    SimulationSetup,
)
from .release import (
    PQ_DEFAULT_RUNNER_SCRIPTS,
    PQ_QM_PROGRAMS,
    PQ_RUNNER_LABELS,
    TARGET_PQ_RELEASE,
)


_SLUG = re.compile(r"[^a-z0-9]+")
_RUNNER_STATUS_ALIASES = {"mace": "mace_mp"}


def plan_requested(
    calculators: list[CalculatorSelection],
    equilibration: EquilibrationStage | None,
) -> bool:
    return bool(calculators) or bool(equilibration and equilibration.enabled)


def render_run_plan(
    request: RunPlanRequest,
    *,
    pq: PQStatus | None = None,
    runners: list[RunnerStatus] | None = None,
) -> PlanRenderResult:
    diagnostics: list[Diagnostic] = []
    selections = _selections(request)
    if not selections:
        return PlanRenderResult(
            files=[],
            diagnostics=[_error("runner.missing", "A QM calculator must be selected.")],
            valid=False,
        )

    runner_ids = [selection.runner_id for selection in selections]
    duplicates = sorted(
        runner_id for runner_id in set(runner_ids) if runner_ids.count(runner_id) > 1
    )
    if duplicates:
        diagnostics.append(
            _error(
                "runner.duplicate",
                f"Select each calculator once: {', '.join(duplicates)}.",
            )
        )
    if pq is not None and not pq.found:
        diagnostics.append(
            _warning(
                "environment.pq_not_detected",
                "PQ was not detected. The inputs can still be created.",
            )
        )

    status_by_id = {status.id: status for status in runners or []}
    files: list[PlannedInput] = []
    multiple_calculators = len(selections) > 1
    equilibration = request.equilibration
    has_equilibration = bool(equilibration and equilibration.enabled)
    stage_count = 2 if has_equilibration else 1

    for selection in selections:
        runner_id = selection.runner_id
        label = _runner_label(runner_id, status_by_id)
        if runner_id not in PQ_QM_PROGRAMS:
            diagnostics.append(
                _error(
                    "runner.unknown",
                    (f"{label} is not available in PQ {TARGET_PQ_RELEASE}."),
                )
            )
        _append_runner_warning(
            diagnostics,
            runner_id=runner_id,
            label=label,
            statuses=status_by_id,
            enabled=runners is not None,
        )

        branch_prefix = request.setup.file_prefix
        if multiple_calculators:
            branch_prefix = f"{branch_prefix}-{_slug(runner_id)}"
        runner_script = _runner_script(request.setup, selection)

        if has_equilibration and equilibration is not None:
            equilibration_setup = _equilibration_setup(
                request.setup,
                equilibration,
                runner_id=runner_id,
                runner_script=runner_script,
                file_prefix=f"{branch_prefix}-equilibration",
            )
            equilibration_result = render_input(equilibration_setup)
            diagnostics.extend(
                _stage_diagnostics(
                    equilibration_result.diagnostics,
                    label,
                    "Equilibration",
                )
            )
            files.append(
                _planned_input(
                    setup=equilibration_setup,
                    result_text=equilibration_result.input_text,
                    name=f"01-{equilibration_setup.file_prefix}.in",
                    stage_id="equilibration",
                    stage_label="NVT equilibration",
                    stage_index=1,
                    stage_count=stage_count,
                    calculator_id=runner_id,
                    calculator_label=label,
                )
            )
            sampling_setup = _sampling_setup(
                request.setup,
                runner_id=runner_id,
                runner_script=runner_script,
                file_prefix=f"{branch_prefix}-sampling",
                start_file=restart_filename(equilibration_setup),
                multiple_calculators=multiple_calculators,
            )
            sampling_name = f"02-{sampling_setup.file_prefix}.in"
        else:
            sampling_setup = _sampling_setup(
                request.setup,
                runner_id=runner_id,
                runner_script=runner_script,
                file_prefix=branch_prefix,
                start_file=request.setup.start_file,
                multiple_calculators=multiple_calculators,
            )
            sampling_name = f"{sampling_setup.file_prefix}.in"

        sampling_result = render_input(sampling_setup)
        diagnostics.extend(
            _stage_diagnostics(
                sampling_result.diagnostics,
                label,
                "Sampling",
            )
        )
        files.append(
            _planned_input(
                setup=sampling_setup,
                result_text=sampling_result.input_text,
                name=sampling_name,
                stage_id="sampling",
                stage_label="Sampling",
                stage_index=stage_count,
                stage_count=stage_count,
                calculator_id=runner_id,
                calculator_label=label,
            )
        )

    return PlanRenderResult(
        files=files,
        diagnostics=diagnostics,
        valid=not any(item.severity == "error" for item in diagnostics),
    )


def _selections(request: RunPlanRequest) -> list[CalculatorSelection]:
    if request.calculators:
        return request.calculators
    if request.setup.runner:
        return [
            CalculatorSelection(
                runner_id=request.setup.runner,
                runner_script=request.setup.runner_script,
            )
        ]
    return []


def _equilibration_setup(
    setup: SimulationSetup,
    stage: EquilibrationStage,
    *,
    runner_id: str,
    runner_script: str | None,
    file_prefix: str,
) -> SimulationSetup:
    return setup.model_copy(
        deep=True,
        update={
            "preset_id": None,
            "ensemble": "NVT",
            "start_file": setup.start_file,
            "restart_file": f"{file_prefix}.rst",
            "file_prefix": file_prefix,
            "steps": stage.steps,
            "timestep_fs": stage.timestep_fs,
            "temperature_k": stage.temperature_k,
            "start_temperature_k": stage.start_temperature_k,
            "temperature_ramp_steps": stage.temperature_ramp_steps,
            "temperature_ramp_frequency": stage.temperature_ramp_frequency,
            "pressure_bar": None,
            "thermostat": stage.thermostat,
            "thermostat_relaxation_ps": stage.thermostat_relaxation_ps,
            "thermostat_friction_ps_inverse": (stage.thermostat_friction_ps_inverse),
            "nh_chain_length": stage.nh_chain_length,
            "coupling_frequency_cm_inverse": (stage.coupling_frequency_cm_inverse),
            "manostat": None,
            "initialize_velocities": True,
            "runner": runner_id,
            "runner_script": runner_script,
        },
    )


def _sampling_setup(
    setup: SimulationSetup,
    *,
    runner_id: str,
    runner_script: str | None,
    file_prefix: str,
    start_file: str,
    multiple_calculators: bool,
) -> SimulationSetup:
    restart_file = setup.restart_file
    if multiple_calculators or start_file != setup.start_file:
        restart_file = f"{file_prefix}.rst"
    return setup.model_copy(
        deep=True,
        update={
            "start_file": start_file,
            "restart_file": restart_file,
            "file_prefix": file_prefix,
            "initialize_velocities": (
                False if start_file != setup.start_file else setup.initialize_velocities
            ),
            "runner": runner_id,
            "runner_script": runner_script,
        },
    )


def _planned_input(
    *,
    setup: SimulationSetup,
    result_text: str,
    name: str,
    stage_id: Literal["equilibration", "sampling"],
    stage_label: str,
    stage_index: int,
    stage_count: int,
    calculator_id: str,
    calculator_label: str,
) -> PlannedInput:
    return PlannedInput(
        name=name,
        stage_id=stage_id,
        stage_label=stage_label,
        stage_index=stage_index,
        stage_count=stage_count,
        calculator_id=calculator_id,
        calculator_label=calculator_label,
        input_text=result_text,
        start_file=setup.start_file,
        restart_file=restart_filename(setup),
    )


def _runner_script(
    setup: SimulationSetup,
    selection: CalculatorSelection,
) -> str | None:
    if selection.runner_script:
        return selection.runner_script
    if selection.runner_id == setup.runner and setup.runner_script:
        return setup.runner_script
    return PQ_DEFAULT_RUNNER_SCRIPTS.get(selection.runner_id)


def _runner_label(
    runner_id: str,
    statuses: dict[str, RunnerStatus],
) -> str:
    status_id = _RUNNER_STATUS_ALIASES.get(runner_id, runner_id)
    status = statuses.get(status_id)
    return status.label if status else PQ_RUNNER_LABELS.get(runner_id, runner_id)


def _append_runner_warning(
    diagnostics: list[Diagnostic],
    *,
    runner_id: str,
    label: str,
    statuses: dict[str, RunnerStatus],
    enabled: bool,
) -> None:
    if not enabled or runner_id not in PQ_QM_PROGRAMS:
        return
    status_id = _RUNNER_STATUS_ALIASES.get(runner_id, runner_id)
    status = statuses.get(status_id)
    if status is None or not status.ready:
        diagnostics.append(
            _warning(
                "runner.not_detected",
                f"{label} was not detected. Its inputs can still be created.",
            )
        )


def _stage_diagnostics(
    diagnostics: list[Diagnostic],
    calculator_label: str,
    stage_label: str,
) -> list[Diagnostic]:
    return [
        item.model_copy(
            update={"message": (f"{calculator_label} · {stage_label}: {item.message}")}
        )
        for item in diagnostics
    ]


def _slug(value: str) -> str:
    return _SLUG.sub("-", value.lower()).strip("-") or "calculator"


def _error(code: str, message: str) -> Diagnostic:
    return Diagnostic(code=code, severity="error", message=message)


def _warning(code: str, message: str) -> Diagnostic:
    return Diagnostic(code=code, severity="warning", message=message)
