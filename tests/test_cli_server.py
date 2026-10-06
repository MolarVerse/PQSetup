from __future__ import annotations

import json
import os
import shlex
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx

from pqsetup.models import SimulationSetup


ROOT = Path(__file__).resolve().parents[1]
DATA = Path(__file__).parent / "data"


def _environment(tmp_path: Path) -> dict[str, str]:
    browser = tmp_path / "browser.py"
    browser.write_text(
        "import json, sys, urllib.request\n"
        "from pathlib import Path\n"
        "result = {'url': sys.argv[1], 'ready': False}\n"
        "try:\n"
        "    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))\n"
        "    with opener.open(sys.argv[1] + '/api/health', timeout=1) as response:\n"
        "        result['ready'] = json.load(response)['status'] == 'ok'\n"
        "except Exception:\n"
        "    pass\n"
        f"receipt = Path({str(tmp_path / 'browser.json')!r})\n"
        "temporary = receipt.with_suffix('.tmp')\n"
        "temporary.write_text(json.dumps(result))\n"
        "temporary.replace(receipt)\n"
    )
    environment = os.environ.copy()
    environment["BROWSER"] = " ".join(
        shlex.quote(item) for item in (sys.executable, str(browser), "%s")
    )
    environment["PQ_EXECUTABLE"] = str(tmp_path / "missing-PQ")
    environment["TERM"] = "dumb"
    return environment


def test_browser_stays_closed_when_the_port_is_occupied(tmp_path: Path) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        result = subprocess.run(
            [sys.executable, "-m", "pqsetup", "serve", "--port", str(listener.getsockname()[1])],
            cwd=ROOT,
            env=_environment(tmp_path),
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )

    assert not (tmp_path / "browser.json").exists()
    assert result.returncode == 1
    assert "Open " not in result.stdout
    assert "Could not listen" in result.stderr
    assert "Traceback" not in result.stderr


def test_server_readiness_actions_and_clean_shutdown(tmp_path: Path) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    url = f"http://127.0.0.1:{port}"
    process = subprocess.Popen(
        [sys.executable, "-m", "pqsetup", "serve", "--port", str(port)],
        cwd=ROOT,
        env=_environment(tmp_path),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        deadline = time.monotonic() + 15
        with httpx.Client(base_url=url, timeout=2, trust_env=False) as client:
            while True:
                if process.poll() is not None:
                    stdout, stderr = process.communicate()
                    raise AssertionError(f"Server exited before readiness:\n{stdout}\n{stderr}")
                try:
                    response = client.get("/api/health")
                    if response.status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                assert time.monotonic() < deadline, "Server did not become ready"
                time.sleep(0.03)

            browser_result = tmp_path / "browser.json"
            while not browser_result.exists():
                assert time.monotonic() < deadline, "Browser was not opened"
                time.sleep(0.03)
            assert json.loads(browser_result.read_text()) == {"url": url, "ready": True}

            for _ in range(3):
                assert client.get("/api/health").status_code == 200
                assert client.get("/api/bootstrap").status_code == 200
                assert client.get("/").status_code == 200

            content = (DATA / "water.rst").read_bytes()
            analysis = client.post(
                "/api/structure/analyze",
                files={"file": ("water.rst", content, "text/plain")},
            )
            assert analysis.status_code == 200
            perturbation = client.post(
                "/api/structure/perturb",
                files={"file": ("water.rst", content, "text/plain")},
                data={"sigma": "0.01", "seed": "17"},
            )
            assert perturbation.status_code == 200
            setup = SimulationSetup(ensemble="NVT", runner="ase_xtb").model_dump(mode="json")
            assert client.post("/api/input/render", json=setup).status_code == 200
            assert client.post(
                "/api/project/export",
                json={
                    "setup": setup,
                    "structure": analysis.json()["structure"],
                    "project_name": "water-run",
                },
            ).status_code == 200
            assert client.post(
                "/api/structure/analyze",
                files={"file": ("broken.xyz", b"not coordinates", "text/plain")},
            ).status_code == 400
            assert client.post("/api/project/export", json={}).status_code == 422
    finally:
        if process.poll() is None:
            process.send_signal(signal.SIGINT)
        try:
            stdout, stderr = process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise AssertionError("Server did not stop after Ctrl+C") from None

    assert process.returncode == 0, stderr
    for event in ("Structure loaded", "Structure perturbed", "Project exported", "Server stopped"):
        assert event in stderr
    assert f"Open   {url}" in stdout
    assert stderr.count("Ready at") == 1
    assert "seed=17" in stderr
    assert "WARNING" in stderr and "HTTP 400" in stderr and "HTTP 422" in stderr
    for path in ("/api/health", "/api/bootstrap", "/api/input/render"):
        assert path not in stderr
    assert "not coordinates" not in stderr
    assert "Traceback" not in stderr
    assert "\x1b[" not in stdout + stderr
