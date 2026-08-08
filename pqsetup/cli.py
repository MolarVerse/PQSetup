from __future__ import annotations

import argparse
import json
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn

from . import __version__
from .executable import discover_pq
from .input_writer import validate_input_file
from .models import DoctorReport
from .pq_validation import PQValidationError, validate_pq_input
from .runners import apply_pq_capabilities, detect_runners


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pqsetup",
        description="Prepare and validate PQ simulation inputs.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )
    parser.add_argument(
        "--pq-executable",
        dest="pq_executable",
        help="Use this PQ executable.",
    )
    subcommands = parser.add_subparsers(dest="command")

    serve = subcommands.add_parser("serve", help="Open the local interface.")
    serve.add_argument(
        "--host",
        choices=("127.0.0.1", "localhost"),
        default="127.0.0.1",
    )
    serve.add_argument("--port", default=8888, type=int)
    serve.add_argument("--no-browser", action="store_true")
    serve.add_argument(
        "--pq-executable",
        dest="command_pq_executable",
        help=argparse.SUPPRESS,
    )

    doctor = subcommands.add_parser("doctor", help="Check PQ and external runners.")
    doctor.add_argument(
        "--pq-executable",
        dest="command_pq_executable",
        help=argparse.SUPPRESS,
    )
    doctor.add_argument("--json", action="store_true")

    validate = subcommands.add_parser("validate", help="Check an existing PQ input.")
    validate.add_argument("input_file", type=Path)
    validate.add_argument("--json", action="store_true")
    validate.add_argument(
        "--pq-executable",
        dest="command_pq_executable",
        help=argparse.SUPPRESS,
    )
    return parser


def main(arguments: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(arguments)
    command = args.command or "serve"
    if command == "serve":
        from .api import create_app

        host = getattr(args, "host", "127.0.0.1")
        port = getattr(args, "port", 8888)
        no_browser = getattr(args, "no_browser", False)
        pq_executable = (
            getattr(args, "command_pq_executable", None) or args.pq_executable
        )
        if not no_browser:
            threading.Timer(
                0.8, lambda: webbrowser.open(f"http://{host}:{port}")
            ).start()
        uvicorn.run(
            create_app(pq_executable=pq_executable),
            host=host,
            port=port,
        )
        return 0
    if command == "doctor":
        pq = discover_pq(
            getattr(args, "command_pq_executable", None) or args.pq_executable
        )
        report = DoctorReport(
            pq=pq,
            runners=apply_pq_capabilities(
                (
                    detect_runners(
                        pq.executable if pq.found else None,
                        external_qm=pq.external_qm,
                    )
                    if pq.external_qm is not None
                    else detect_runners(pq.executable if pq.found else None)
                ),
                pq.capabilities,
            ),
            diagnostics=[],
        )
        if args.json:
            print(report.model_dump_json(indent=2))
        else:
            _print_doctor(report)
        return 0 if report.pq.found else 1
    if command == "validate":
        diagnostics = validate_input_file(args.input_file)
        core_diagnostics = []
        core_valid = True
        core_checked = False
        validation_note: str | None = None
        validation_error = False
        if not any(item.severity == "error" for item in diagnostics):
            pq = discover_pq(
                getattr(args, "command_pq_executable", None) or args.pq_executable
            )
            if pq.found and pq.executable and pq.supports_validation("installed"):
                try:
                    result = validate_pq_input(
                        pq.executable,
                        args.input_file,
                        scope="installed",
                    )
                except PQValidationError as error:
                    print(
                        f"PQ input validation could not be completed: {error}",
                        file=sys.stderr,
                    )
                    return 2
                core_checked = True
                core_diagnostics = result.diagnostics
                core_valid = result.valid
            elif not pq.found:
                validation_note = f"PQ validation was not run: {pq.detail}"
                validation_error = pq.source in {
                    "option",
                    "config",
                    "environment",
                }
            else:
                validation_note = (
                    "PQ validation was not run: installed PQ does not "
                    "advertise installed validation."
                )
        if args.json:
            environment_diagnostic = (
                [
                    {
                        "code": "environment.pq_validation_not_run",
                        "severity": ("error" if validation_error else "warning"),
                        "message": validation_note,
                        "atom_indices": [],
                    }
                ]
                if validation_note
                else []
            )
            print(
                json.dumps(
                    [
                        *(item.model_dump(mode="json") for item in diagnostics),
                        *(item.model_dump(mode="json") for item in core_diagnostics),
                        *environment_diagnostic,
                    ],
                    indent=2,
                )
            )
        elif diagnostics or core_diagnostics or validation_note:
            for diagnostic in diagnostics:
                print(f"{diagnostic.severity.upper():7} {diagnostic.message}")
            for core_diagnostic in core_diagnostics:
                location = f" · {core_diagnostic.file}"
                if core_diagnostic.line is not None:
                    location += f":{core_diagnostic.line}"
                print(
                    f"{core_diagnostic.severity.upper():7} "
                    f"{core_diagnostic.message}{location}"
                )
            if validation_note:
                marker = "ERROR" if validation_error else "WARNING"
                print(f"{marker:7} {validation_note}")
        else:
            print("Valid." if core_checked else "Local checks passed.")
        has_local_error = any(item.severity == "error" for item in diagnostics)
        if validation_error:
            return 2
        return 1 if has_local_error or not core_valid else 0
    parser.print_help()
    return 2


def _print_doctor(report: DoctorReport) -> None:
    marker = "detected" if report.pq.found else "not detected"
    executable = f" · {report.pq.executable}" if report.pq.executable else ""
    print(f"PQ             {marker}{executable}")
    for runner in report.runners:
        if not runner.supported:
            state = "unsupported"
        elif runner.available_in_pq is False and runner.ready:
            state = "calculator ready · PQ build mismatch"
        elif runner.available_in_pq is False and runner.installed:
            state = (
                f"calculator setup incomplete · {runner.detail} "
                "· PQ build mismatch"
            )
        elif runner.available_in_pq is False:
            state = "calculator not detected · PQ build mismatch"
        elif runner.ready:
            state = "detected"
        elif runner.installed:
            state = f"setup incomplete · {runner.detail}"
        else:
            state = "not detected"
        print(f"{runner.label:14} {state}")


if __name__ == "__main__":
    sys.exit(main())
