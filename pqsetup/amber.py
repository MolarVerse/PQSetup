"""Adapter for prepared AMBER systems."""

from pathlib import Path

from pydantic import BaseModel

from .models import SetupFile, SetupFileRole, StructureAnalysis
from .structures import analyze_structure, parse_structure_bytes

_COMPANIONS: dict[SetupFileRole, str] = {
    "moldescriptor": "moldescriptor.dat",
    "topology": "topology.top",
    "parameter": "parameter.prm",
    "intra_nonbonded": "intra_nonbonded.dat",
    "mshake": "mshake.dat",
}


class AmberImport(BaseModel):
    analysis: StructureAnalysis
    setup_files: list[SetupFile]
    restart: str
    pq_input: str
    cutoff: float
    settings: dict[str, str | float]


def amber_available() -> bool:
    try:
        from parmed.amber import AmberParm, Rst7
        from PQAnalysis.io.force_field.api import convert_structure

        return callable(AmberParm) and callable(Rst7) and callable(convert_structure)
    except ImportError:
        return False


def import_amber(topology: Path, coordinates: Path, output: Path) -> AmberImport:
    """Convert a prepared AMBER pair, without format autodetection."""
    from parmed.amber import AmberParm, Rst7
    from PQAnalysis.io.force_field.api import convert_structure
    from PQAnalysis.io.force_field.exceptions import Parm2PQError

    try:
        system = AmberParm(str(topology))
        restart_data = Rst7.open(str(coordinates))
    except Exception as error:
        raise ValueError("Could not read the AMBER topology or restart.") from error
    if restart_data.natom != len(system.atoms):
        raise ValueError("The AMBER topology and restart have different atom counts.")
    system.coordinates = restart_data.coordinates
    if restart_data.hasbox:
        system.box = restart_data.box
    if restart_data.hasvels:
        system.velocities = restart_data.velocities
    cutoff = 12.0
    try:
        converted = convert_structure(system, shake_h=True, rcoulomb=cutoff)
    except Parm2PQError as error:
        raise ValueError(str(error)) from error
    converted.write(output, rcoulomb=cutoff)
    restart = (output / "start.rst").read_text()
    analysis = analyze_structure(parse_structure_bytes("start.rst", restart.encode()))
    files = [
        SetupFile(role=role, name=name, content=(output / name).read_text())
        for role, name in _COMPANIONS.items()
        if role != "mshake" or (output / name).is_file()
    ]
    method, _ = converted.long_range(None)
    settings: dict[str, str | float] = {"long_range": method}
    if method == "wolf":
        settings["wolf_param"] = 0.2
    if converted.mshake:
        settings["shake"] = "mshake"
    elif converted.shake:
        settings["shake"] = "on"
    return AmberImport(
        analysis=analysis, setup_files=files, restart=restart,
        pq_input=(output / "pq_input.in").read_text(), cutoff=cutoff,
        settings=settings,
    )
