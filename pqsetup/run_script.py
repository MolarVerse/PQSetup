from __future__ import annotations

import shlex
from collections.abc import Sequence


RUN_SCRIPT_NAME = "run.sh"


def render_run_script(execution_order: Sequence[str]) -> str:
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
    return (
        """#!/usr/bin/env bash
# Run the linked PQ inputs in order and stop at the first failed simulation.
set -euo pipefail

usage() {
    printf 'Usage: %s [PQ executable]\\n' "$0"
    printf '       PQ_EXECUTABLE=/path/to/PQ %s\\n' "$0"
}

if (( $# > 1 )); then
    usage >&2
    exit 2
fi

pq_executable=${PQ_EXECUTABLE:-PQ}
if (( $# == 1 )); then
    pq_executable=$1
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

log_directory=run-logs
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
        return "$pq_status"
    fi
    if ! grep -Fq -- 'PQ ended normally' "$log_file"; then
        printf 'Simulation failed: %s did not report normal completion.\\n' \\
            "$input_file" >&2
        return 1
    fi
    printf 'Finished %s\\n' "$input_file"
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
