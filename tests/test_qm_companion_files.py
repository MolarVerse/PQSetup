from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import pqsetup.api
from pqsetup.api import _validate_export_inputs, create_app
from pqsetup.models import (
    PQStatus,
    RunPlanRequest,
    RunnerStatus,
    SetupFileReference,
    SimulationSetup,
)
from pqsetup.run_plan import render_run_plan
from pqsetup.structures import parse_structure_bytes


DATA = Path(__file__).parent / "data"


def _pq() -> PQStatus:
    return PQStatus(found=False, detail="PQ was not found.")


def _runner(runner_id: str) -> RunnerStatus:
    return RunnerStatus(
        id=runner_id,
        label=runner_id,
        supported=True,
        installed=True,
        ready=True,
        detail="Ready.",
    )


def test_direct_dftb_requires_and_writes_its_template() -> None:
    setup = SimulationSetup(
        runner="dftbplus",
        dftb_template_file="dftb_in.template",
    )
    result = render_run_plan(
        RunPlanRequest(
            setup=setup,
            setup_files=[
                SetupFileReference(
                    role="dftb_template",
                    name="dftb_in.template",
                )
            ],
        ),
        pq=_pq(),
        runners=[_runner("dftbplus")],
    )

    assert result.valid
    assert "dftb_file = dftb_in.template;" in result.files[0].input_text

    missing = render_run_plan(
        RunPlanRequest(
            setup=setup.model_copy(update={"dftb_template_file": None}),
        ),
        pq=_pq(),
        runners=[_runner("dftbplus")],
    )
    assert not missing.valid
    assert "qm.dftb_template_file" in {
        diagnostic.code for diagnostic in missing.diagnostics
    }


def test_qm_npt_requires_and_writes_a_molecule_descriptor() -> None:
    setup = SimulationSetup(
        ensemble="NPT",
        runner="ase_xtb",
        pressure_bar=1.01325,
        manostat="stochastic_rescaling",
        moldescriptor_file="moldescriptor.dat",
    )
    result = render_run_plan(
        RunPlanRequest(
            setup=setup,
            setup_files=[
                SetupFileReference(
                    role="moldescriptor",
                    name="moldescriptor.dat",
                )
            ],
        ),
        pq=_pq(),
        runners=[_runner("ase_xtb")],
    )

    assert result.valid
    assert "moldescriptor_file = moldescriptor.dat;" in result.files[0].input_text

    missing = render_run_plan(
        RunPlanRequest(setup=setup.model_copy(update={"moldescriptor_file": None})),
        pq=_pq(),
        runners=[_runner("ase_xtb")],
    )
    assert not missing.valid
    assert "qm.moldescriptor_file" in {
        diagnostic.code for diagnostic in missing.diagnostics
    }


def test_direct_dftb_export_packages_the_typed_template(monkeypatch) -> None:
    monkeypatch.setattr(pqsetup.api, "discover_pq", lambda _: _pq())
    monkeypatch.setattr(
        pqsetup.api,
        "detect_runners",
        lambda _: [_runner("dftbplus")],
    )
    structure = parse_structure_bytes(
        "water.rst",
        (DATA / "water.rst").read_bytes(),
    )
    setup = SimulationSetup(
        runner="dftbplus",
        dftb_template_file="dftb_in.template",
    )

    response = TestClient(create_app()).post(
        "/api/project/export",
        json={
            "setup": setup.model_dump(mode="json"),
            "structure": structure.model_dump(mode="json"),
            "project_name": "water-dftb",
            "sampling_run_count": 1,
            "setup_files": [
                {
                    "role": "dftb_template",
                    "name": "dftb_in.template",
                    "content": "Driver = VelocityVerlet {}\n",
                }
            ],
        },
    )

    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert "dftb_in.template" in archive.namelist()
        assert "dftb_file = dftb_in.template;" in archive.read("run-01.in").decode()


def test_turbomole_export_packages_its_define_template(monkeypatch) -> None:
    monkeypatch.setattr(pqsetup.api, "discover_pq", lambda _: _pq())
    monkeypatch.setattr(
        pqsetup.api,
        "detect_runners",
        lambda _, **__: [_runner("turbomole")],
    )
    structure = parse_structure_bytes(
        "water.rst",
        (DATA / "water.rst").read_bytes(),
    )
    setup = SimulationSetup(
        runner="turbomole",
        turbomole_define_template_file="tm_define.template",
    )

    missing = render_run_plan(
        RunPlanRequest(setup=setup),
        pq=_pq(),
        runners=[_runner("turbomole")],
    )
    response = TestClient(create_app()).post(
        "/api/project/export",
        json={
            "setup": setup.model_dump(mode="json"),
            "structure": structure.model_dump(mode="json"),
            "project_name": "water-rimp2",
            "sampling_run_count": 1,
            "setup_files": [
                {
                    "role": "turbomole_define_template",
                    "name": "tm_define.template",
                    "content": "$title\nwater\n",
                }
            ],
        },
    )

    assert not missing.valid
    assert "qm.file_missing.turbomole_define_template" in {
        diagnostic.code for diagnostic in missing.diagnostics
    }
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert "tm_define.template" in archive.namelist()
        assert "qm_script = turbomole_rimp2;" in archive.read("run-01.in").decode()


def test_turbomole_rejects_a_renamed_define_template(monkeypatch) -> None:
    monkeypatch.setattr(pqsetup.api, "discover_pq", lambda _: _pq())
    monkeypatch.setattr(
        pqsetup.api,
        "detect_runners",
        lambda _, **__: [_runner("turbomole")],
    )
    structure = parse_structure_bytes(
        "water.rst",
        (DATA / "water.rst").read_bytes(),
    )
    setup = SimulationSetup(
        runner="turbomole",
        turbomole_define_template_file="custom.template",
    )
    setup_file = SetupFileReference(
        role="turbomole_define_template",
        name="custom.template",
    )

    plan = render_run_plan(
        RunPlanRequest(setup=setup, setup_files=[setup_file]),
        pq=_pq(),
        runners=[_runner("turbomole")],
    )
    response = TestClient(create_app()).post(
        "/api/project/export",
        json={
            "setup": setup.model_dump(mode="json"),
            "structure": structure.model_dump(mode="json"),
            "project_name": "water-rimp2",
            "sampling_run_count": 1,
            "setup_files": [
                {
                    **setup_file.model_dump(mode="json"),
                    "content": "$title\nwater\n",
                }
            ],
        },
    )

    assert not plan.valid
    assert "qm.file_required_name.turbomole_define_template" in {
        diagnostic.code for diagnostic in plan.diagnostics
    }
    assert response.status_code == 422
    assert "tm_define.template" in response.text


def test_setup_filename_limit_uses_utf8_bytes(monkeypatch) -> None:
    monkeypatch.setattr(pqsetup.api, "discover_pq", lambda _: _pq())
    monkeypatch.setattr(
        pqsetup.api,
        "detect_runners",
        lambda _: [_runner("dftbplus")],
    )
    structure = parse_structure_bytes(
        "water.rst",
        (DATA / "water.rst").read_bytes(),
    )
    long_name = f"{'é' * 126}.template"
    setup = SimulationSetup(
        runner="dftbplus",
        dftb_template_file=long_name,
    )

    response = TestClient(create_app()).post(
        "/api/project/export",
        json={
            "setup": setup.model_dump(mode="json"),
            "structure": structure.model_dump(mode="json"),
            "project_name": "water-dftb",
            "sampling_run_count": 1,
            "setup_files": [
                {
                    "role": "dftb_template",
                    "name": long_name,
                    "content": "template\n",
                }
            ],
        },
    )

    assert response.status_code == 422
    assert "too long" in response.text.lower()


def test_validation_materialization_errors_are_recoverable(
    monkeypatch,
) -> None:
    pq = PQStatus(
        found=True,
        executable="/tools/PQ",
        detail="Ready.",
        validation_available=True,
        validation_scopes=["portable"],
    )

    def fail_write(*_: object, **__: object) -> int:
        raise OSError("filesystem unavailable")

    monkeypatch.setattr(Path, "write_text", fail_write)

    with pytest.raises(HTTPException) as error:
        _validate_export_inputs(
            pq,
            input_names=["run.in"],
            files=[("run.in", "jobtype = qm-md;\n")],
        )

    assert error.value.status_code == 422
    assert "could not be prepared" in str(error.value.detail)
