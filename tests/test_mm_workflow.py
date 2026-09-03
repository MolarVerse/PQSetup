from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import pqsetup.api
from pqsetup.api import create_app
from pqsetup.models import PQStatus, SimulationSetup
from pqsetup.structures import parse_structure_bytes


DATA = Path(__file__).parent / "data"

MOLDESCRIPTOR = """\
WATER_TYPE 1
H2O 3 0.0
O 0 -0.65966 0
H 1 0.32983 1
H 1 0.32983 1
"""

GUFF = """\
1;0;1;0;-1.0;144.538;26758.20;8.85910;0.000;1.000;0.000;1.000;0.000;1.000;0.0000;1.000;0.000;0.000;1.00000;0.000;-0.250;-4.00000;3.40000;2.000;-0.250;-1.500;4.500;2.000;
1;0;1;1;5.0;-72.269;6.234030;9.19912;0.000;1.000;0.000;1.000;0.000;1.000;-10.00;40.00;1.050;-4.00;5.49305;2.200;0.0000;1.000000;0.00000;1.000;0.0000;1.0000;0.000;1.000;
1;1;1;1;3.0;36.1345;0.000000;1.00000;0.000;1.000;0.000;1.000;0.000;1.000;18.000;40.00;2.050;0.000;1.00000;0.000;-17.00;-7.62177;1.45251;2.000;0.0000;1.0000;0.000;1.000;
"""

TOPOLOGY = """\
# Minimal package fixture. PQSetup preserves topology content verbatim.
[ atoms ]
1 O 1 WAT O 1 -0.65966
"""

PARAMETERS = """\
# Minimal package fixture. PQSetup preserves parameter content verbatim.
[ atomtypes ]
O 15.999
"""

INTRA_NONBONDED = """\
# Minimal package fixture. PQSetup preserves exclusion content verbatim.
1
END
"""

_ROLE_TO_FIELD = {
    "moldescriptor": "moldescriptor_file",
    "guff": "guff_file",
    "topology": "topology_file",
    "parameter": "parameter_file",
    "intra_nonbonded": "intra_nonbonded_file",
}

_ROLE_TO_NAME = {
    "moldescriptor": "moldescriptor.dat",
    "guff": "guff.dat",
    "topology": "water.top",
    "parameter": "water.param",
    "intra_nonbonded": "intra-nonbonded.dat",
}

_ROLE_TO_CONTENT = {
    "moldescriptor": MOLDESCRIPTOR,
    "guff": GUFF,
    "topology": TOPOLOGY,
    "parameter": PARAMETERS,
    "intra_nonbonded": INTRA_NONBONDED,
}

_ROLES_BY_MODE = {
    "off": ("moldescriptor", "guff"),
    "bonded": ("moldescriptor", "guff", "topology", "parameter"),
    "on": ("moldescriptor", "topology", "parameter", "intra_nonbonded"),
}


def _stable_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setattr(
        pqsetup.api,
        "discover_pq",
        lambda _: PQStatus(
            found=False,
            executable=None,
            version=None,
            source=None,
            detail="Not found.",
        ),
    )
    monkeypatch.setattr(pqsetup.api, "detect_runners", lambda _: [])
    return TestClient(create_app())


def _mm_setup(
    mode: str = "off",
    *,
    ensemble: str = "NVT",
    generated_cell: bool = False,
) -> dict[str, object]:
    setup = SimulationSetup(
        job_type="mm-md",
        ensemble=ensemble,
        runner=None,
        start_file="structure.rst",
        file_prefix="water-mm",
        steps=1,
        timestep_fs=0.5,
        temperature_k=298.15,
        pressure_bar=1.01325 if ensemble == "NPT" else None,
        manostat="stochastic_rescaling" if ensemble == "NPT" else None,
        random_seed=17,
    ).model_dump(mode="json")
    setup.update(
        {
            "mm_force_field": mode,
            "density_g_cm3": 0.9523 if generated_cell else None,
            "coulomb_cutoff_angstrom": 1.4 if generated_cell else 5.0,
        }
    )
    for role in _ROLES_BY_MODE[mode]:
        setup[_ROLE_TO_FIELD[role]] = _ROLE_TO_NAME[role]
    return setup


def _setup_files(
    mode: str,
    *,
    references_only: bool,
) -> list[dict[str, str]]:
    files = []
    for role in _ROLES_BY_MODE[mode]:
        item = {
            "role": role,
            "name": _ROLE_TO_NAME[role],
        }
        if not references_only:
            item["content"] = _ROLE_TO_CONTENT[role]
        files.append(item)
    return files


def _water_structure(*, generated_cell: bool) -> dict[str, object]:
    filename = "water.xyz" if generated_cell else "water.rst"
    structure = parse_structure_bytes(filename, (DATA / filename).read_bytes())
    for atom in structure.atoms:
        atom.molecule_type = 1
    return structure.model_dump(mode="json")


def _export_payload(
    mode: str = "off",
    *,
    generated_cell: bool = False,
    ensemble: str = "NVT",
) -> dict[str, object]:
    return {
        "setup": _mm_setup(
            mode,
            ensemble=ensemble,
            generated_cell=generated_cell,
        ),
        "setup_files": _setup_files(mode, references_only=False),
        "structure": _water_structure(generated_cell=generated_cell),
        "project_name": "water-mm",
        "sampling_run_count": 1,
    }


@pytest.mark.parametrize(
    ("mode", "present", "absent"),
    [
        (
            "off",
            (
                "moldescriptor_file = moldescriptor.dat;",
                "guff_file = guff.dat;",
            ),
            ("topology_file =", "parameter_file =", "intra-nonbonded_file ="),
        ),
        (
            "bonded",
            (
                "moldescriptor_file = moldescriptor.dat;",
                "guff_file = guff.dat;",
                "topology_file = water.top;",
                "parameter_file = water.param;",
            ),
            ("intra-nonbonded_file =",),
        ),
        (
            "on",
            (
                "moldescriptor_file = moldescriptor.dat;",
                "topology_file = water.top;",
                "parameter_file = water.param;",
                "intra-nonbonded_file = intra-nonbonded.dat;",
            ),
            ("guff_file =",),
        ),
    ],
)
def test_mm_force_field_modes_render_current_pq_keys(
    mode: str,
    present: tuple[str, ...],
    absent: tuple[str, ...],
) -> None:
    response = TestClient(create_app()).post(
        "/api/input/render",
        json=_mm_setup(mode, generated_cell=True),
    )

    assert response.status_code == 200
    rendered = response.json()
    assert rendered["valid"], rendered["diagnostics"]
    text = rendered["input_text"]
    assert "jobtype = mm-md;" in text
    assert f"force-field = {mode};" in text
    assert "density = 0.9523;" in text
    assert "virial = molecular;" in text
    assert "rcoulomb = 1.4;" in text
    assert "qm_prog =" not in text
    for line in present:
        assert line in text
    for line in absent:
        assert line not in text


def test_mm_run_plan_does_not_require_a_qm_runner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = _stable_client(monkeypatch).post(
        "/api/plan/render",
        json={
            "setup": _mm_setup("off"),
            "setup_files": _setup_files("off", references_only=True),
            "sampling_run_count": 2,
        },
    )

    assert response.status_code == 200
    plan = response.json()
    assert plan["valid"], plan["diagnostics"]
    assert [item["name"] for item in plan["files"]] == [
        "run-01.in",
        "run-02.in",
    ]
    assert all("qm_prog =" not in item["input_text"] for item in plan["files"])
    assert not any(
        item["code"].startswith("runner.") for item in plan["diagnostics"]
    )


@pytest.mark.parametrize(
    ("mode", "missing_role"),
    [
        ("off", "guff"),
        ("bonded", "topology"),
        ("on", "parameter"),
    ],
)
def test_mm_plan_reports_missing_required_companion_files(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
    missing_role: str,
) -> None:
    files = [
        item
        for item in _setup_files(mode, references_only=True)
        if item["role"] != missing_role
    ]
    response = _stable_client(monkeypatch).post(
        "/api/plan/render",
        json={
            "setup": _mm_setup(mode),
            "setup_files": files,
            "sampling_run_count": 1,
        },
    )

    assert response.status_code == 200
    plan = response.json()
    assert not plan["valid"]
    messages = " ".join(item["message"] for item in plan["diagnostics"]).lower()
    assert missing_role.replace("_", " ") in messages


def test_generated_cell_mm_npt_uses_density_instead_of_exporting_a_box(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = _stable_client(monkeypatch).post(
        "/api/project/export",
        json=_export_payload(
            generated_cell=True,
            ensemble="NPT",
        ),
    )

    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        restart = archive.read("structure.rst").decode()
        input_text = archive.read("run-01.in").decode()
        manifest = json.loads(archive.read("pqproject.json"))

    assert "\nBox " not in restart
    assert "density = 0.9523;" in input_text
    assert manifest["structure"]["cell_generated"]


def test_export_packages_companion_files_with_verified_hashes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = _stable_client(monkeypatch).post(
        "/api/project/export",
        json=_export_payload("on"),
    )

    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("pqproject.json"))
        packaged = manifest["files"]["setup_files"]
        assert {item["role"] for item in packaged} == set(_ROLES_BY_MODE["on"])
        for item in packaged:
            content = archive.read(item["name"])
            assert content.decode() == _ROLE_TO_CONTENT[item["role"]]
            assert hashlib.sha256(content).hexdigest() == item["sha256"]


@pytest.mark.parametrize(
    "reserved_name",
    ["run-01.in", "structure.rst", "run.sh", "pqproject.json"],
)
def test_export_rejects_companion_file_package_collisions(
    monkeypatch: pytest.MonkeyPatch,
    reserved_name: str,
) -> None:
    payload = _export_payload("off")
    setup = payload["setup"]
    setup_files = payload["setup_files"]
    assert isinstance(setup, dict)
    assert isinstance(setup_files, list)
    setup["moldescriptor_file"] = reserved_name
    setup_files[0]["name"] = reserved_name

    response = _stable_client(monkeypatch).post(
        "/api/project/export",
        json=payload,
    )

    assert response.status_code == 422
    detail = str(response.json()["detail"]).lower()
    assert any(word in detail for word in ("collision", "conflict", "reserved"))


def test_export_rejects_duplicate_companion_file_names(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _export_payload("off")
    setup = payload["setup"]
    setup_files = payload["setup_files"]
    assert isinstance(setup, dict)
    assert isinstance(setup_files, list)
    setup["guff_file"] = "moldescriptor.dat"
    setup_files[1]["name"] = "moldescriptor.dat"

    response = _stable_client(monkeypatch).post(
        "/api/project/export",
        json=payload,
    )

    assert response.status_code == 422
    detail = str(response.json()["detail"]).lower()
    assert any(word in detail for word in ("duplicate", "collision", "conflict"))


def test_export_rejects_qm_companion_file_for_mm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _export_payload("off")
    setup_files = payload["setup_files"]
    assert isinstance(setup_files, list)
    setup_files.append(
        {
            "role": "dftb_template",
            "name": "dftb_in.template",
            "content": "Hamiltonian = DFTB {}",
        }
    )

    response = _stable_client(monkeypatch).post(
        "/api/project/export",
        json=payload,
    )

    assert response.status_code == 422
    assert "not used by the selected mm setup" in response.text.lower()


def test_export_requires_a_configured_optional_companion_file(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _export_payload("on")
    setup_files = payload["setup_files"]
    assert isinstance(setup_files, list)
    payload["setup_files"] = [
        item for item in setup_files if item["role"] != "intra_nonbonded"
    ]

    response = _stable_client(monkeypatch).post(
        "/api/project/export",
        json=payload,
    )

    assert response.status_code == 422
    assert "intramolecular nonbonded" in response.text.lower()


@pytest.mark.parametrize(
    "unsafe_name",
    ["structure.rst\u0000copy", "folder\\moldescriptor.dat"],
)
def test_export_rejects_unsafe_setup_filenames(
    monkeypatch: pytest.MonkeyPatch,
    unsafe_name: str,
) -> None:
    payload = _export_payload("off")
    setup = payload["setup"]
    setup_files = payload["setup_files"]
    assert isinstance(setup, dict)
    assert isinstance(setup_files, list)
    setup["moldescriptor_file"] = unsafe_name
    setup_files[0]["name"] = unsafe_name

    response = _stable_client(monkeypatch).post(
        "/api/project/export",
        json=payload,
    )

    assert response.status_code == 422
    assert "invalid character" in response.text.lower()


@pytest.mark.parametrize("dot_name", [".", ".."])
def test_export_rejects_dot_setup_filenames(
    monkeypatch: pytest.MonkeyPatch,
    dot_name: str,
) -> None:
    payload = _export_payload("off")
    setup = payload["setup"]
    setup_files = payload["setup_files"]
    assert isinstance(setup, dict)
    assert isinstance(setup_files, list)
    setup["moldescriptor_file"] = dot_name
    setup_files[0]["name"] = dot_name

    response = _stable_client(monkeypatch).post(
        "/api/project/export",
        json=payload,
    )

    assert response.status_code == 422
    detail = response.text.lower()
    assert "filename" in detail
    assert ("path" in detail) or ("setup file" in detail)


@pytest.mark.parametrize("runtime_name", ["water-mm-01.rst", "run-logs"])
def test_export_reserves_runtime_paths(
    monkeypatch: pytest.MonkeyPatch,
    runtime_name: str,
) -> None:
    payload = _export_payload("off")
    setup = payload["setup"]
    setup_files = payload["setup_files"]
    assert isinstance(setup, dict)
    assert isinstance(setup_files, list)
    setup["moldescriptor_file"] = runtime_name
    setup_files[0]["name"] = runtime_name

    response = _stable_client(monkeypatch).post(
        "/api/project/export",
        json=payload,
    )

    assert response.status_code == 422
    assert "conflicts with a generated file" in response.text.lower()


def test_export_rejects_descriptor_incompatible_molecule_layout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _export_payload("off")
    structure = payload["structure"]
    assert isinstance(structure, dict)
    atoms = structure["atoms"]
    assert isinstance(atoms, list)
    atoms[-1]["molecule_type"] = 2

    response = _stable_client(monkeypatch).post(
        "/api/project/export",
        json=payload,
    )

    assert response.status_code == 422
    assert "3 consecutive atoms" in response.text


def _real_pq_executable() -> Path | None:
    configured = os.environ.get("PQ_REAL_EXECUTABLE")
    candidates = [
        Path(configured) if configured else None,
        Path(__file__).resolve().parents[2] / "PQ" / "build" / "apps" / "PQ",
        Path(__file__).resolve().parents[2]
        / "PQ"
        / "build_static"
        / "apps"
        / "PQ",
    ]
    return next(
        (
            candidate
            for candidate in candidates
            if candidate is not None
            and candidate.is_file()
            and os.access(candidate, os.X_OK)
        ),
        None,
    )


def test_exported_minimal_mm_package_runs_with_real_pq(
    tmp_path: Path,
) -> None:
    executable = _real_pq_executable()
    if executable is None:
        pytest.skip("Set PQ_REAL_EXECUTABLE to run the real PQ MM smoke test.")

    payload = _export_payload("off", generated_cell=True)
    setup = payload["setup"]
    assert isinstance(setup, dict)
    setup["coulomb_cutoff_angstrom"] = 1.4
    response = TestClient(create_app(pq_executable=str(executable))).post(
        "/api/project/export",
        json=payload,
    )
    assert response.status_code == 200, response.text

    bundle_directory = tmp_path / "mm-package"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        archive.extractall(bundle_directory)
    completed = subprocess.run(
        ["bash", "run.sh", str(executable)],
        cwd=bundle_directory,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "PQ ended normally" in (
        bundle_directory / "run-logs" / "run-01.log"
    ).read_text()
