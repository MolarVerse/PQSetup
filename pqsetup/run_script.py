from __future__ import annotations

import shlex
from collections.abc import Iterable, Sequence


RUN_SCRIPT_NAME = "run.sh"

# Files PQ writes for one file_prefix (PQ's output file settings).
PQ_OUTPUT_SUFFIXES = (
    ".rst",
    ".log",
    ".ref",
    ".xyz",
    ".extxyz",
    ".center.xyz",
    ".en",
    ".instant_en",
    ".force",
    ".vel",
    ".chrg",
    ".info",
    ".mom",
    ".vir",
    ".stress",
    ".box",
    ".opt",
    ".rpmd.rst",
    ".rpmd.xyz",
    ".rpmd.vel",
    ".rpmd.force",
    ".rpmd.chrg",
    ".rpmd.en",
    ".timings",
)

# PQ imports ASE/MACE in its embedded interpreter, which follows python3 on
# PATH and PYTHONPATH; the PySCF script is started with `python`.
_EMBEDDED_PYTHON = "python3"
_CALCULATOR_PYTHON_MODULES: dict[str, tuple[tuple[str, str], ...]] = {
    "ase_dftbplus": ((_EMBEDDED_PYTHON, "ase"),),
    "ase_xtb": ((_EMBEDDED_PYTHON, "ase"),),
    "mace": ((_EMBEDDED_PYTHON, "ase"), (_EMBEDDED_PYTHON, "mace")),
    "mace_mp": ((_EMBEDDED_PYTHON, "ase"), (_EMBEDDED_PYTHON, "mace")),
    "mace_off": ((_EMBEDDED_PYTHON, "ase"), (_EMBEDDED_PYTHON, "mace")),
    "pyscf": (("python", "pyscf"),),
}
_PIP_PACKAGES = {"ase": "ase", "mace": "mace-torch", "pyscf": "pyscf"}


def python_requirements(calculator_ids: Iterable[str]) -> list[tuple[str, str]]:
    """(interpreter, top-level module) pairs the calculators import at run time."""
    requirements: dict[tuple[str, str], None] = {}
    for calculator_id in calculator_ids:
        for requirement in _CALCULATOR_PYTHON_MODULES.get(calculator_id, ()):
            requirements[requirement] = None
    return list(requirements)


def render_run_script(
    execution_order: Sequence[str],
    *,
    output_prefixes: Sequence[str] = (),
    python_modules: Sequence[tuple[str, str]] = (),
) -> str:
    if not execution_order:
        raise ValueError("A run script needs at least one input file.")

    run_lines = [
        (
            f"run_input {shlex.quote(input_name)} {index} "
            f"{shlex.quote(_log_name(input_name))}"
        )
        for index, input_name in enumerate(execution_order, start=1)
    ]
    total = len(execution_order)
    prefixes = " ".join(shlex.quote(prefix) for prefix in output_prefixes)
    suffixes = " ".join(shlex.quote(suffix) for suffix in PQ_OUTPUT_SUFFIXES)
    module_lines = "\n".join(
        f"    {shlex.quote(interpreter)} {shlex.quote(module)} "
        f"{shlex.quote(_PIP_PACKAGES.get(module, module))}"
        for interpreter, module in python_modules
    )
    return (
        """#!/usr/bin/env bash
# Run the linked PQ inputs in order and stop at the first failed simulation.
set -euo pipefail

usage() {
    printf 'Usage: %s [--fresh] [--skip-check] [PQ executable]\\n' "$0"
    printf '       PQ_EXECUTABLE=/path/to/PQ %s\\n' "$0"
    printf '  --fresh       move outputs of an earlier attempt into attempt-N/\\n'
    printf '  --skip-check  do not check the calculator Python modules\\n'
}

fresh=0
skip_check=0
positional=()
for argument in "$@"; do
    case "$argument" in
        --fresh) fresh=1 ;;
        --skip-check) skip_check=1 ;;
        -h|--help) usage; exit 0 ;;
        -*) usage >&2; exit 2 ;;
        *) positional+=("$argument") ;;
    esac
done
if (( ${#positional[@]} > 1 )); then
    usage >&2
    exit 2
fi

pq_executable=${PQ_EXECUTABLE:-PQ}
if (( ${#positional[@]} == 1 )); then
    pq_executable=${positional[0]}
fi

resolved_executable=$(command -v "$pq_executable" 2>/dev/null) || {
    printf 'PQ executable not found: %s\\n' "$pq_executable" >&2
    exit 127
}
if [[ "$resolved_executable" != /* ]]; then
    executable_directory=$(
        CDPATH= cd -P "$(dirname "$resolved_executable")" >/dev/null 2>&1 && pwd
    ) || {
        printf 'Could not resolve PQ executable: %s\\n' "$pq_executable" >&2
        exit 127
    }
    resolved_executable=$executable_directory/$(basename "$resolved_executable")
fi
pq_executable=$resolved_executable
if [[ ! -x "$pq_executable" ]]; then
    printf 'PQ executable is not executable: %s\\n' "$pq_executable" >&2
    exit 126
fi

script_directory=$(
    CDPATH= cd -P "$(dirname "$0")" >/dev/null 2>&1 && pwd
) || {
    printf 'Could not locate the run package.\\n' >&2
    exit 1
}
cd "$script_directory"

# interpreter, top-level module, package that provides it
python_modules=(
"""
        + module_lines
        + """
)
missing_modules=0
if (( skip_check )); then
    python_modules=()
fi
for (( i = 0; i < ${#python_modules[@]}; i += 3 )); do
    interpreter=${python_modules[i]}
    module=${python_modules[i + 1]}
    package=${python_modules[i + 2]}
    if ! command -v "$interpreter" >/dev/null 2>&1; then
        printf 'Calculator check: %s not found on PATH; the calculator needs it.\\n' \\
            "$interpreter" >&2
        missing_modules=1
    elif ! "$interpreter" -c \\
        'import importlib.util, sys; sys.exit(importlib.util.find_spec(sys.argv[1]) is None)' \\
        "$module" >/dev/null 2>&1; then
        printf 'Calculator check: Python module %s not found by %s (%s).\\n' \\
            "$module" "$interpreter" "$(command -v "$interpreter")" >&2
        printf '  Activate the environment that provides it, set PYTHONPATH,\\n' >&2
        printf '  or install it there: python -m pip install %s\\n' "$package" >&2
        missing_modules=1
    fi
done
if (( missing_modules )); then
    printf 'Nothing was run. Fix the environment and run %s again,\\n' "$0" >&2
    printf 'or use --skip-check if PQ uses a different Python.\\n' >&2
    exit 3
fi

log_directory=run-logs
output_prefixes=("""
        + prefixes
        + """)
output_suffixes=("""
        + suffixes
        + """)

earlier_outputs=()
for prefix in ${output_prefixes[@]+"${output_prefixes[@]}"}; do
    for suffix in "${output_suffixes[@]}"; do
        if [[ -e "$prefix$suffix" ]]; then
            earlier_outputs+=("$prefix$suffix")
        fi
    done
done
if [[ -d "$log_directory" ]] && [[ -n "$(ls -A "$log_directory")" ]]; then
    earlier_outputs+=("$log_directory")
fi

if (( ${#earlier_outputs[@]} > 0 )); then
    if (( ! fresh )); then
        printf 'Outputs of an earlier attempt are in this folder:\\n' >&2
        printf '  %s\\n' "${earlier_outputs[@]}" >&2
        printf 'PQ does not overwrite them. Run %s --fresh to move them\\n' "$0" >&2
        printf 'into attempt-N/ and start again; nothing is deleted.\\n' >&2
        exit 4
    fi
    attempt=1
    while [[ -e "attempt-$attempt" ]]; do
        attempt=$((attempt + 1))
    done
    mkdir "attempt-$attempt"
    mv -- "${earlier_outputs[@]}" "attempt-$attempt/"
    printf 'Moved %s earlier outputs to attempt-%s/\\n' \\
        "${#earlier_outputs[@]}" "$attempt"
fi

mkdir -p "$log_directory"
run_total="""
        + str(total)
        + """

run_input() {
    local input_file=$1
    local run_number=$2
    local log_file=$3
    local -a pipeline_status
    local pq_status
    local tee_status

    printf '\\n[%s/%s] PQ %s\\n' "$run_number" "$run_total" "$input_file"
    if "$pq_executable" "$input_file" 2>&1 | tee "$log_file"; then
        pipeline_status=("${PIPESTATUS[@]}")
    else
        pipeline_status=("${PIPESTATUS[@]}")
    fi
    pq_status=${pipeline_status[0]}
    tee_status=${pipeline_status[1]}

    if (( tee_status != 0 )); then
        printf 'Could not write the run log: %s\\n' "$log_file" >&2
        return "$tee_status"
    fi
    if (( pq_status != 0 )); then
        printf 'Simulation failed: %s exited with status %s.\\n' \\
            "$input_file" "$pq_status" >&2
        retry_hint
        return "$pq_status"
    fi
    if ! grep -Fq -- 'PQ ended normally' "$log_file"; then
        printf 'Simulation failed: %s did not report normal completion.\\n' \\
            "$input_file" >&2
        retry_hint
        return 1
    fi
    printf 'Finished %s\\n' "$input_file"
}

retry_hint() {
    printf 'After fixing the cause, run %s --fresh to keep this attempt\\n' "$0" >&2
    printf 'in attempt-N/ and start again.\\n' >&2
}

printf 'PQ executable: %s\\n' "$pq_executable"
printf 'Input files: %s\\n' "$run_total"
printf 'Logs: %s/\\n' "$log_directory"

"""
        + "\n".join(run_lines)
        + """

printf '\\nCompleted %s input files.\\n' "$run_total"
"""
    )


def _log_name(input_name: str) -> str:
    stem = input_name.removesuffix(".in")
    return f"run-logs/{stem}.log"
