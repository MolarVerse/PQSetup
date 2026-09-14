from __future__ import annotations

import io
import os
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from pqsetup.api import create_app
from pqsetup.companions import (
    discover_slakos_3ob,
    seed_missing_setup_files,
    water_dftb_template,
    water_moldescriptor,
)
from pqsetup.models import (
    PQStatus,
    RunPlanRequest,
    RunnerStatus,
    SetupFile,
    SimulationSetup,
    Structure,
)
from pqsetup.run_plan import render_run_plan


WATER = Structure(
    atoms=[
        {"symbol": "O", "position": (0.0, 0.0, 0.0), "molecule_type": 0},
        {"symbol": "H", "position": (0.9572, 0.0, 0.0), "molecule_type": 0},
        {"symbol": "H", "position": (-0.239987, 0.927297, 0.0), "molecule_type": 0},
    ],
    cell=((12.0, 0.0, 0.0), (0.0, 12.0, 0.0), (0.0, 0.0, 12.0)),
    periodic=(True, True, True),
    source_name="water-example.rst",
    source_format="pq-restart",
    wrapped_centered=True,
    cell_generated=False,
)


def _runner(runner_id: str) -> RunnerStatus:
    return RunnerStatus(
        id=runner_id,
        label=runner_id,
        supported=True,
        installed=True,
        ready=True,
        detail="Ready.",
    )


def test_water_companions_are_bundled() -> None:
    assert "H2O" in water_moldescriptor()
    assert "__PQ_SLAKOS_3OB__" in water_dftb_template()
    filled = water_dftb_template(slakos_prefix="/tmp/sk")
    assert "/tmp/sk/" in filled
    assert "__PQ_SLAKOS_3OB__" not in filled


def test_plan_render_seeds_dftb_without_upload() -> None:
    result = render_run_plan(
        RunPlanRequest(
            setup=SimulationSetup(
                runner="dftbplus",
                runner_script="dftbplus_periodic_stress",
            ),
            setup_files=[],
        ),
        pq=PQStatus(found=False, detail="PQ was not found."),
        runners=[_runner("dftbplus")],
    )
    assert result.valid
    assert "dftb_file = dftb_in.template;" in result.files[0].input_text


def test_export_seeds_dftb_template_without_upload() -> None:
    client = TestClient(create_app())
    response = client.post(
        "/api/project/export",
        json={
            "project_name": "water-dftb",
            "structure": WATER.model_dump(mode="json"),
            "setup": {
                "job_type": "qm-md",
                "ensemble": "NVT",
                "start_file": "water-example.rst",
                "file_prefix": "water",
                "steps": 3,
                "timestep_fs": 0.5,
                "temperature_k": 298.15,
                "thermostat": "velocity_rescaling",
                "initialize_velocities": True,
                "runner": "dftbplus",
                "runner_script": "dftbplus_periodic_stress",
                "mm_force_field": "off",
            },
            "equilibration": {
                "enabled": False,
                "steps": 5,
                "timestep_fs": 0.5,
                "temperature_k": 298.15,
            },
            "sampling_run_count": 1,
            "setup_files": [],
            "preparation": None,
        },
    )
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert "dftb_in.template" in archive.namelist()
        assert "Hamiltonian" in archive.read("dftb_in.template").decode("utf-8")


def test_export_rejects_seeded_dftb_for_non_water_elements() -> None:
    methane = WATER.model_copy(deep=True)
    methane.atoms[0].symbol = "C"
    client = TestClient(create_app())
    response = client.post(
        "/api/project/export",
        json={
            "project_name": "methane-dftb",
            "structure": methane.model_dump(mode="json"),
            "setup": {
                "job_type": "qm-md",
                "ensemble": "NVT",
                "start_file": "water-example.rst",
                "file_prefix": "methane",
                "steps": 3,
                "timestep_fs": 0.5,
                "temperature_k": 298.15,
                "thermostat": "velocity_rescaling",
                "initialize_velocities": True,
                "runner": "dftbplus",
                "runner_script": "dftbplus_periodic_stress",
                "mm_force_field": "off",
            },
            "equilibration": {
                "enabled": False,
                "steps": 5,
                "timestep_fs": 0.5,
                "temperature_k": 298.15,
            },
            "sampling_run_count": 1,
            "setup_files": [],
            "preparation": None,
        },
    )
    assert response.status_code == 422
    assert "H and O" in str(response.json())


def test_discover_slakos_near_pq_build() -> None:
    pq = os.environ.get("PQ_EXECUTABLE")
    if not pq or not Path(pq).is_file():
        return
    found = discover_slakos_3ob(pq)
    assert found is not None
    assert (found / "O-H.skf").is_file()


def test_seed_keeps_custom_dftb_template() -> None:
    custom = "# CUSTOM-DFTB-TEMPLATE\nGeometry = GenFormat { <<< \"geom.gen\" }\n"
    setup = SimulationSetup(
        runner="dftbplus",
        runner_script="dftbplus_periodic_stress",
        dftb_template_file="my-dftb.template",
    )
    seeded = seed_missing_setup_files(
        setup,
        [
            SetupFile(
                role="dftb_template",
                name="my-dftb.template",
                content=custom,
            )
        ],
        ["dftb_template"],
    )

    assert len(seeded) == 1
    assert seeded[0].name == "my-dftb.template"
    assert seeded[0].content == custom


def test_export_keeps_custom_dftb_template_in_zip() -> None:
    custom = (
        "# CUSTOM-DFTB-TEMPLATE\n"
        "Geometry = GenFormat {\n<<< \"geom.gen\"\n}\n"
        "Driver = {}\n"
        "Hamiltonian = DFTB {\n  charge = 0\n  SCC = Yes\n"
        "  MaxAngularMomentum { O = \"p\"\n H = \"s\" }\n"
        "  SlaterKosterFiles = Type2FileNames {\n"
        "    Prefix = \"/unused/\"\n"
        "    Separator = \"-\"\n"
        "    Suffix = \".skf\"\n"
        "  }\n"
        "}\n"
        "ParserOptions { ParserVersion = 5 }\n"
    )
    client = TestClient(create_app())
    response = client.post(
        "/api/project/export",
        json={
            "project_name": "custom-dftb",
            "structure": WATER.model_dump(mode="json"),
            "setup": {
                "job_type": "qm-md",
                "ensemble": "NVT",
                "start_file": "water-example.rst",
                "file_prefix": "water",
                "steps": 3,
                "timestep_fs": 0.5,
                "temperature_k": 298.15,
                "thermostat": "velocity_rescaling",
                "initialize_velocities": True,
                "runner": "dftbplus",
                "runner_script": "dftbplus_periodic_stress",
                "dftb_template_file": "my-dftb.template",
                "mm_force_field": "off",
            },
            "equilibration": {
                "enabled": False,
                "steps": 5,
                "timestep_fs": 0.5,
                "temperature_k": 298.15,
            },
            "sampling_run_count": 1,
            "setup_files": [
                {
                    "role": "dftb_template",
                    "name": "my-dftb.template",
                    "content": custom,
                }
            ],
            "preparation": None,
        },
    )
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = set(archive.namelist())
        assert "my-dftb.template" in names
        assert "dftb_in.template" not in names
        text = archive.read("my-dftb.template").decode("utf-8")
        input_text = archive.read("run-01.in").decode("utf-8")
    assert text == custom
    assert "dftb_file = my-dftb.template;" in input_text
