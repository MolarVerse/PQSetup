from __future__ import annotations

import argparse
import json
import sys
import threading
import webbrowser
from pathlib import Path

import uvicorn

from .api import create_app
from .executable import discover_pq
from .input_writer import validate_input_file
from .models import DoctorReport
from .runners import detect_runners


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pqsetup",
        description="Prepare and validate PQ simulation inputs.",
    )
    parser.add_argument(
        "--pq-executable",
        dest="pq_executable",
        help="Use this PQ executable.",
    )
    subcommands = parser.add_subparsers(dest="command")

    serve = subcommands.add_parser("serve", help="Open the local interface.")
    serve.add_argument("--host", default="127.0.0.1")
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
    return parser


def main(arguments: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(arguments)
    command = args.command or "serve"
    if command == "serve":
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
            runners=detect_runners(pq.executable if pq.found else None),
            diagnostics=[],
        )
        if args.json:
            print(report.model_dump_json(indent=2))
        else:
            _print_doctor(report)
        return 0 if report.pq.found else 1
    if command == "validate":
        diagnostics = validate_input_file(args.input_file)
        if args.json:
            print(
                json.dumps(
                    [item.model_dump(mode="json") for item in diagnostics],
                    indent=2,
                )
            )
        elif diagnostics:
            for item in diagnostics:
                print(f"{item.severity.upper():7} {item.message}")
        else:
            print("Valid.")
        return 1 if any(item.severity == "error" for item in diagnostics) else 0
    parser.print_help()
    return 2


def _print_doctor(report: DoctorReport) -> None:
    marker = "detected" if report.pq.found else "not detected"
    executable = f" · {report.pq.executable}" if report.pq.executable else ""
    print(f"PQ             {marker}{executable}")
    for runner in report.runners:
        if not runner.supported:
            state = "unsupported"
        elif runner.ready:
            state = "detected"
        elif runner.installed:
            state = f"setup incomplete · {runner.detail}"
        else:
            state = "not detected"
        print(f"{runner.label:14} {state}")


if __name__ == "__main__":
    sys.exit(main())
