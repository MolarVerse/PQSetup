"""Manage one local PQ run and its companion apps."""

from __future__ import annotations

import io
import json
import shutil
import socket
import subprocess
import tempfile
import time
import zipfile
from collections import deque
from pathlib import Path
from threading import Lock, Thread
from urllib.error import URLError
from urllib.request import urlopen

from fastapi import HTTPException


def _launcher_log_tail(path: Path) -> str:
    try:
        with path.open("rb") as log:
            size = log.seek(0, io.SEEK_END)
            log.seek(max(0, size - 8192))
            if size > 8192:
                log.readline()
            return log.read(8192).decode("utf-8", errors="replace").strip()
    except OSError:
        return ""


def _restart_step(path: Path) -> int | None:
    try:
        with path.open("rb") as restart:
            marker, step = restart.readline(128).split()
            return int(step) if marker == b"Step" else None
    except (OSError, ValueError):
        return None


def _trajectory_ready(path: Path) -> bool:
    try:
        with path.open("rb") as trajectory:
            count = int(trajectory.readline().split(maxsplit=1)[0])
            return count > 0 and trajectory.readline().endswith(b"\n") and all(
                trajectory.readline().endswith(b"\n") for _ in range(count)
            )
    except (OSError, ValueError, IndexError):
        return False


def _energy_ready(path: Path) -> bool:
    try:
        with path.open("rb") as energy:
            return any(
                line.endswith(b"\n") and line.split(maxsplit=1)[0].isdigit()
                for line in energy if line.strip() and not line.startswith(b"#")
            )
    except OSError:
        return False


class ManagedRun:
    def __init__(self, root: Path, portal_origin: str | None = None):
        self.portal_origin = portal_origin
        self.root = root.resolve()
        self.lock = Lock()
        self.directory: Path | None = None
        self.process: subprocess.Popen | None = None
        self.inputs: list[dict] = []
        self.progress = {"state": "idle"}
        self.samples: deque[tuple[float, int]] = deque()
        self.started = 0.0
        self.companions: dict[tuple[str, int], tuple[subprocess.Popen, str]] = {}

    def start(self, archive: bytes, executable: str) -> None:
        with self.lock:
            if self.process is not None and self.progress["state"] == "running":
                raise HTTPException(409, "A simulation is already running.")
            self.root.mkdir(parents=True, exist_ok=True)
            directory = Path(tempfile.mkdtemp(prefix="run-", dir=self.root))
            with zipfile.ZipFile(io.BytesIO(archive)) as package:
                manifest = json.loads(package.read("pqproject.json"))
                if manifest["validation"]["status"] != "passed":
                    raise HTTPException(422, "Starting a run requires PQ portable validation.")
                if any(Path(name).name != name or name in {".", ".."} for name in package.namelist()):
                    raise HTTPException(422, "The run package contains an invalid filename.")
                package.extractall(directory)

            inputs = manifest["files"]["inputs"]
            metadata = directory / ".pqsetup"
            metadata.mkdir()
            with (metadata / "launcher.log").open("wb") as log:
                process = subprocess.Popen(
                    ["bash", str(directory / "run.sh"), executable],
                    cwd=directory, stdin=subprocess.DEVNULL, stdout=log,
                    stderr=subprocess.STDOUT, start_new_session=True,
                )
            self._close_companions()
            self.directory, self.process, self.inputs = directory, process, inputs
            self.samples.clear()
            self.started = time.monotonic()
            self.progress = {"state": "running"}
            self._snapshot()
            Thread(target=self._monitor, args=(process,), daemon=True).start()

    def _snapshot(self) -> None:
        directory = self.directory
        process = self.process
        assert directory is not None and process is not None
        exit_code = process.poll()
        stage = completed = 0
        try:
            _, _, stage_text, completed_text, *_ = (
                directory / "run-logs" / "progress.tsv"
            ).read_text(encoding="ascii").strip().split("\t")
            stage, completed = int(stage_text), int(completed_text)
        except (OSError, ValueError):
            pass

        total = sum(item["steps"] for item in self.inputs)
        steps = sum(item["steps"] for item in self.inputs[:completed])
        if completed < stage <= len(self.inputs):
            current = self.inputs[stage - 1]
            start = _restart_step(directory / current["start_file"])
            latest = _restart_step(directory / current["restart_file"])
            if start is not None and latest is not None:
                steps += max(0, min(latest - start, current["steps"]))
        steps = max(steps, self.progress.get("steps", 0))
        if exit_code == 0:
            steps, completed = total, len(self.inputs)

        outputs = []
        for number, item in enumerate(self.inputs[:stage], start=1):
            prefix = directory / item["restart_file"].removesuffix(".rst")
            trajectory = next((path for suffix in (".extxyz", ".xyz")
                               if _trajectory_ready(path := Path(str(prefix) + suffix))), None)
            energy = Path(str(prefix) + ".en")
            outputs.append({
                "stage": number, "label": item["label"],
                "viewer": trajectory.name if trajectory else None,
                "enalyzer": energy.name if _energy_ready(energy) else None,
            })
        now = time.monotonic()
        if not self.samples or steps > self.samples[-1][1]:
            self.samples.append((now, steps))
        while len(self.samples) > 1 and now - self.samples[0][0] > 20:
            self.samples.popleft()
        speed = eta = None
        first_at, first_steps = self.samples[0]
        latest_at, latest_steps = self.samples[-1]
        if (exit_code is None and steps < total and len(self.samples) >= 3
                and latest_at - first_at >= 2 and now - latest_at < 5):
            speed = (latest_steps - first_steps) / (latest_at - first_at)
            eta = round((total - steps) / speed)
        self.progress = {
            "elapsed_seconds": round(now - self.started),
            "steps_per_second": speed, "eta_seconds": eta,
            "state": "running" if exit_code is None else "completed" if exit_code == 0 else "failed",
            "stage": stage, "total": len(self.inputs),
            "steps": steps, "target": total, "exit_code": exit_code,
            "outputs": outputs,
        }
        if exit_code not in (None, 0):
            self.progress["log_tail"] = _launcher_log_tail(directory / ".pqsetup" / "launcher.log")
        temporary = directory / ".pqsetup" / ".progress.json"
        temporary.write_text(json.dumps(self.progress), encoding="utf-8")
        temporary.replace(directory / ".pqsetup" / "progress.json")

    def _monitor(self, process: subprocess.Popen) -> None:
        warmed = set()
        while True:
            with self.lock:
                if self.process is not process:
                    return
                self._snapshot()
                progress = self.progress
            for app in ("viewer", "enalyzer"):
                stage = next((item["stage"] for item in progress["outputs"] if item[app]), None)
                if stage is not None and app not in warmed:
                    warmed.add(app)
                    Thread(target=self._warm, args=(process, app, stage), daemon=True).start()
            if progress["state"] != "running":
                return
            time.sleep(1)

    def _warm(self, run: subprocess.Popen, app: str, stage: int) -> None:
        try:
            self.open_app(app, stage, run=run)
        except (HTTPException, OSError):
            pass

    def _close_companions(self) -> None:
        for process, _ in self.companions.values():
            if process.poll() is None:
                process.terminate()
        self.companions.clear()

    def close(self) -> None:
        with self.lock:
            self._close_companions()

    def open_app(self, app: str, stage: int, *, run: subprocess.Popen | None = None) -> str:
        with self.lock:
            if run is not None and self.process is not run:
                raise HTTPException(409, "The active run changed.")
            output = next((item for item in self.progress.get("outputs", [])
                           if item["stage"] == stage), None)
            if self.directory is None or not output or not output[app]:
                raise HTTPException(409, "This stage has no readable output for that app yet.")
            key = app, stage
            existing = self.companions.get(key)
            if existing and existing[0].poll() is None:
                return existing[1]
            command = "pqviewer" if app == "viewer" else "pqenalyzer"
            executable = shutil.which(command)
            if not executable:
                raise HTTPException(503, f"Install {command} and put it on the PQSetup server's PATH.")
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                port = listener.getsockname()[1]
            source = str(self.directory / output[app])
            args = [executable, source]
            if app == "enalyzer":
                args = [executable, "web", source, "--run-progress", str(self.directory / ".pqsetup" / "progress.json")]
            url = f"http://127.0.0.1:{port}"
            with (self.directory / ".pqsetup" / f"{app}-{stage}.log").open("ab") as log:
                process = subprocess.Popen(
                    [*args, "--port", str(port), "--no-open"], stdin=subprocess.DEVNULL,
                    stdout=log, stderr=subprocess.STDOUT,
                )
            for _ in range(60):
                if process.poll() is not None:
                    break
                try:
                    with urlopen(url + ("/api/health" if app == "viewer" else "/api/status"), timeout=0.25):
                        if process.poll() is None:
                            self.companions[key] = process, url
                            return url
                except (OSError, URLError):
                    time.sleep(0.1)
            if process.poll() is None:
                process.terminate()
            raise HTTPException(503, f"Could not start {command}. Check its log in the run folder.")
