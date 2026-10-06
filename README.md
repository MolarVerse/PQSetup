<img src="https://raw.githubusercontent.com/MolarVerse/PQSetup/main/frontend/public/pq-logo.png" alt="PQSetup logo" width="200">

[![CI](https://github.com/MolarVerse/PQSetup/actions/workflows/ci.yml/badge.svg)](https://github.com/MolarVerse/PQSetup/actions/workflows/ci.yml)
[![Docs](https://github.com/MolarVerse/PQSetup/actions/workflows/docs.yml/badge.svg)](https://molarverse.github.io/PQSetup/)
[![PyPI](https://img.shields.io/pypi/v/molarverse-pqsetup.svg)](https://pypi.org/project/molarverse-pqsetup/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# PQSetup

Prepare and inspect portable input packages for
[PQ](https://github.com/MolarVerse/PQ) in a local browser. PQSetup writes
inputs for the stable PQ v0.7.0 release; PQ performs the simulation.

## Install and open

PQSetup requires Python 3.11 or newer. The browser interface is included in
the package.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install MolarVerse-PQSetup
pqsetup
```

## First package

| Stage | Check before continuing |
| --- | --- |
| Structure | Import the intended structure and confirm atom count, formula, and cell type. |
| Method | Choose QM or MM, then supply the calculator or force-field files it needs. |
| Run | Set the ensemble, coupling, timestep, length, and optional equilibration stage. |
| Output | Resolve every error and inspect each generated PQ input before packaging. |

![PQSetup structure, method, and run controls](docs/assets/screenshots/workspace.png)

The bundled water structure is a short vacuum example. Replace its structure,
method, and run length with values suitable for the scientific question.

On the machine that will run PQ, inspect the environment, unpack the download,
validate an input when parser validation is available, and run the package:

```bash
pqsetup doctor
unzip water-nvt.zip -d water-nvt
cd water-nvt
pqsetup validate run-01.in
./run.sh /path/to/PQ
```

PQ execution and scheduler submission remain separate. Validation checks
inputs and the available software environment; model choice, stability,
equilibration, sampling, and convergence require scientific review.

## Manual

- [Getting started](https://molarverse.github.io/PQSetup/getting-started.html)
- [Build a run](https://molarverse.github.io/PQSetup/workflow.html)
- [Validation and its limits](https://molarverse.github.io/PQSetup/validation.html)
- [PQ, calculator, and structure compatibility](https://molarverse.github.io/PQSetup/reference/compatibility.html)
- [Run-package contents and execution order](https://molarverse.github.io/PQSetup/run-packages.html)
- [Remote access through VPN and SSH](https://molarverse.github.io/PQSetup/remote-access.html)

The [complete manual](https://molarverse.github.io/PQSetup/) also covers the
command line, advanced settings, troubleshooting, shared PQDesign components,
and [contributor setup](https://molarverse.github.io/PQSetup/development.html).
