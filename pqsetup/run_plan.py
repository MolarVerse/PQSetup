from __future__ import annotations

from typing import Literal

from .external_qm import selected_external_qm_script
from .input_writer import render_input, restart_filename
from .mm import (
    mm_method_label,
    validate_mm_setup_contents,
    validate_mm_setup_files,
    validate_mm_structure,
)
from .models import (
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
    PQ_QM_PROGRAMS,
    PQ_RUNNER_LABELS,
    TARGET_PQ_RELEASE,
)
from .setup_files import validate_qm_setup_files


_RUNNER_STATUS_ALIASES = {"mace": "mace_mp"}
_UINT32_RANGE = 2**32


def plan_requested(
    sampling_run_count: int | None,
    equilibration: EquilibrationStage | None,
) -> bool:
    return sampling_run_count is not None or bool(
        equilibration and equilibration.enabled
    )


def render_run_plan(
    request: RunPlanRequest,
    *,
    pq: PQStatus | None = None,
    runners: list[RunnerStatus] | None = None,
) -> PlanRenderResult:
    diagnostics: list[Diagnostic] = []
    setup = request.setup
    is_mm = setup.job_type == "mm-md"
    runner_id = setup.runner
    external_qm = pq.external_qm if pq is not None else None
    if not is_mm and not runner_id:
        return PlanRenderResult(
            files=[],
            diagnostics=[_error("runner.missing", "A QM calculator must be selected.")],
            valid=False,
        )
    if not 0 <= request.setup.random_seed < _UINT32_RANGE:
        return PlanRenderResult(
            files=[],
            diagnostics=[
                _error(
                    "run.random_seed",
                    "Random seed must be between 0 and 4294967295.",
                )
            ],
            valid=False,
        )

    restart_collision = _restart_collision(request)
    if restart_collision:
        return PlanRenderResult(
            files=[],
            diagnostics=[
                _error(
                    "input.restart_collision",
                    (
                        f"Start file '{request.setup.start_file}' conflicts with "
                        f"generated restart '{restart_collision}'. Rename the "
                        "structure or run."
                    ),
                )
            ],
            valid=False,
        )

    if pq is not None and not pq.found:
        diagnostics.append(
            _warning(
                "environment.pq_not_detected",
                "PQ was not detected. The inputs can still be created.",
            )
        )

    status_by_id = {status.id: status for status in runners or []}
    if is_mm:
        method_id = "molecular_mechanics"
        label = mm_method_label(request.setup.mm_force_field)
        diagnostics.extend(validate_mm_setup_files(request.setup, request.setup_files))
        if request.structure is not None:
            diagnostics.extend(validate_mm_structure(request.setup, request.structure))
            diagnostics.extend(
                validate_mm_setup_contents(
                    request.setup,
                    request.structure,
                    request.setup_files,
                )
            )
    else:
        method_id = runner_id or ""
        label = _runner_label(method_id, status_by_id)
        script, script_error = selected_external_qm_script(
            method_id,
            setup.runner_script,
            external_qm,
        )
        if script_error:
            diagnostics.append(_error("runner.script", script_error))
            return PlanRenderResult(files=[], diagnostics=diagnostics, valid=False)
        if script is not None and setup.runner_script != script.name:
            setup = setup.model_copy(update={"runner_script": script.name})
        diagnostics.extend(
            validate_qm_setup_files(
                setup,
                request.setup_files,
                external_qm,
            )
        )
        if method_id not in PQ_QM_PROGRAMS:
            diagnostics.append(
                _error(
                    "runner.unknown",
                    f"{label} is not available in PQ {TARGET_PQ_RELEASE}.",
                )
            )
        _append_runner_warning(
            diagnostics,
            runner_id=method_id,
            label=label,
            statuses=status_by_id,
            enabled=runners is not None,
        )
        _append_pq_capability_warning(
            diagnostics,
            pq=pq,
            runner_id=method_id,
            label=label,
        )

    equilibration = request.equilibration
    has_equilibration = bool(equilibration and equilibration.enabled)
    stage_count = request.sampling_run_count + int(has_equilibration)
    stage_index = 1
    previous_restart = request.setup.start_file
    files: list[PlannedInput] = []

    if has_equilibration and equilibration is not None:
        equilibration_setup = _equilibration_setup(
            setup,
            equilibration,
            file_prefix=f"{setup.file_prefix}-eq",
            random_seed=_derived_seed(setup.random_seed, stage_index),
        )
        equilibration_result = render_input(
            equilibration_setup,
            external_qm=external_qm,
        )
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
                name="run-eq.in",
                stage_id="equilibration",
                stage_label="NVT equilibration",
                stage_index=stage_index,
                stage_count=stage_count,
                segment_index=None,
                segment_count=None,
                calculator_id=method_id,
                calculator_label=label,
            )
        )
        previous_restart = restart_filename(equilibration_setup)
        stage_index += 1

    for segment_index in range(1, request.sampling_run_count + 1):
        segment_code = f"{segment_index:02d}"
        sampling_setup = _sampling_setup(
            setup,
            file_prefix=f"{setup.file_prefix}-{segment_code}",
            start_file=previous_restart,
            initialize_velocities=(
                setup.initialize_velocities if stage_index == 1 else False
            ),
            segment_index=segment_index,
            random_seed=_derived_seed(setup.random_seed, stage_index),
        )
        sampling_result = render_input(
            sampling_setup,
            external_qm=external_qm,
        )
        diagnostics.extend(
            _stage_diagnostics(
                sampling_result.diagnostics,
                label,
                f"Sampling {segment_code}",
            )
        )
        files.append(
            _planned_input(
                setup=sampling_setup,
                result_text=sampling_result.input_text,
                name=f"run-{segment_code}.in",
                stage_id="sampling",
                stage_label=f"Sampling {segment_code}",
                stage_index=stage_index,
                stage_count=stage_count,
                segment_index=segment_index,
                segment_count=request.sampling_run_count,
                calculator_id=method_id,
                calculator_label=label,
            )
        )
        previous_restart = restart_filename(sampling_setup)
        stage_index += 1

    return PlanRenderResult(
        files=files,
        diagnostics=diagnostics,
        valid=not any(item.severity == "error" for item in diagnostics),
    )


def _equilibration_setup(
    setup: SimulationSetup,
    stage: EquilibrationStage,
    *,
    file_prefix: str,
    random_seed: int,
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
            "random_seed": random_seed,
        },
    )


def _sampling_setup(
    setup: SimulationSetup,
    *,
    file_prefix: str,
    start_file: str,
    initialize_velocities: bool,
    segment_index: int,
    random_seed: int,
) -> SimulationSetup:
    updates: dict[str, object] = {
        "start_file": start_file,
        "restart_file": f"{file_prefix}.rst",
        "file_prefix": file_prefix,
        "initialize_velocities": initialize_velocities,
        "random_seed": random_seed,
    }
    if segment_index > 1:
        updates.update(
            {
                "start_temperature_k": None,
                "temperature_ramp_steps": None,
            }
        )
    return setup.model_copy(
        deep=True,
        update=updates,
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
    segment_index: int | None,
    segment_count: int | None,
    calculator_id: str,
    calculator_label: str,
) -> PlannedInput:
    return PlannedInput(
        name=name,
        stage_id=stage_id,
        stage_label=stage_label,
        stage_index=stage_index,
        stage_count=stage_count,
        segment_index=segment_index,
        segment_count=segment_count,
        calculator_id=calculator_id,
        calculator_label=calculator_label,
        input_text=result_text,
        start_file=setup.start_file,
        restart_file=restart_filename(setup),
    )


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
    if status is None:
        diagnostics.append(
            _warning(
                "runner.not_detected",
                f"{label} was not detected. Its inputs can still be created.",
            )
        )
    elif not status.ready:
        diagnostics.append(
            _warning(
                "runner.incomplete" if status.installed else "runner.not_detected",
                f"{status.detail} Inputs can still be created.",
            )
        )


def _append_pq_capability_warning(
    diagnostics: list[Diagnostic],
    *,
    pq: PQStatus | None,
    runner_id: str,
    label: str,
) -> None:
    if pq is None or not pq.found or pq.capabilities is None:
        return
    input_capabilities = pq.capabilities.get("input")
    if not isinstance(input_capabilities, dict):
        return
    qm_programs = input_capabilities.get("qm_programs")
    if not isinstance(qm_programs, list) or not all(
        isinstance(item, str) for item in qm_programs
    ):
        return
    if runner_id in qm_programs:
        return
    version = f" {pq.version}" if pq.version else ""
    diagnostics.append(
        _warning(
            "environment.pq_method_unavailable",
            (
                f"Installed PQ{version} was built without {label}. "
                "The inputs remain portable; run them with a compatible "
                "PQ build."
            ),
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


def _derived_seed(base_seed: int, stage_index: int) -> int:
    return (base_seed + stage_index - 1) % _UINT32_RANGE


def _restart_collision(request: RunPlanRequest) -> str | None:
    generated = [
        f"{request.setup.file_prefix}-{index:02d}.rst"
        for index in range(1, request.sampling_run_count + 1)
    ]
    if request.equilibration and request.equilibration.enabled:
        generated.insert(0, f"{request.setup.file_prefix}-eq.rst")

    start_file = request.setup.start_file.casefold()
    return next((name for name in generated if name.casefold() == start_file), None)


def _error(code: str, message: str) -> Diagnostic:
    return Diagnostic(code=code, severity="error", message=message)


def _warning(code: str, message: str) -> Diagnostic:
    return Diagnostic(code=code, severity="warning", message=message)
