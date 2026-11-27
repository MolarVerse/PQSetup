import os
from pathlib import Path

import pytest

from pqsetup.amber import import_amber


def test_import_prepared_amber(tmp_path):
    fixture = os.environ.get("PQSETUP_AMBER_FIXTURE")
    if fixture is None:
        pytest.skip("Set PQSETUP_AMBER_FIXTURE to a prepared AMBER directory.")
    source = Path(fixture)
    result = import_amber(source / "system.prmtop", source / "system.inpcrd", tmp_path)
    assert result.analysis.summary.atom_count == 4826
    assert set(file.role for file in result.setup_files) == {
        "moldescriptor", "topology", "parameter", "intra_nonbonded",
    }
    assert "long_range = wolf;" in result.pq_input
    assert "shake = on;" in result.pq_input
