<img src="https://raw.githubusercontent.com/MolarVerse/PQSetup/main/frontend/public/pq-logo.png" alt="PQSetup logo" width="200">

[![CI](https://github.com/MolarVerse/PQSetup/actions/workflows/ci.yml/badge.svg)](https://github.com/MolarVerse/PQSetup/actions/workflows/ci.yml)
[![Docs](https://github.com/MolarVerse/PQSetup/actions/workflows/docs.yml/badge.svg)](https://molarverse.github.io/PQSetup/)
[![PyPI](https://img.shields.io/pypi/v/molarverse-pqsetup.svg)](https://pypi.org/project/molarverse-pqsetup/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# PQSetup

Prepare and validate PQ simulation inputs in a local browser interface.

PQSetup builds the input package. [PQ](https://github.com/MolarVerse/PQ) runs it.

[Documentation](https://molarverse.github.io/PQSetup/) ·
[Getting started](https://molarverse.github.io/PQSetup/getting-started.html) ·
[Command line](https://molarverse.github.io/PQSetup/reference/cli.html)

## Install

Python 3.11 or newer. The UI ships inside the package; Node.js is not required.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install MolarVerse-PQSetup
```

From a local clone (contributors):

```bash
python -m pip install .
```

## Quick Start

```bash
pqsetup
```

Keep the water example, choose a method, review the inputs, download the
package, then run it where PQ is installed:

```bash
unzip water-nvt.zip -d water-nvt
cd water-nvt
./run.sh /path/to/PQ
```

Check what this machine can see:

```bash
pqsetup doctor
pqsetup --pq-executable /path/to/PQ doctor
```

Validate an existing input:

```bash
pqsetup validate run.in
```

See the [documentation](https://molarverse.github.io/PQSetup/) for server
options, validation scopes, and complete setup examples.

## Input

| Structure | Extension | Handling |
| --- | --- | --- |
| PQ restart | `.rst` | Preserves atom names, molecule types, and available velocities or forces |
| CIF | `.cif` | Read through ASE |
| XYZ | `.xyz`, `.extxyz` | Reads standard and extended XYZ data |
| Protein Data Bank | `.pdb` | Read through ASE |
| MOL / SDF | `.mol`, `.sdf` | Read through ASE |
| ASE trajectory | `.traj` | Read through ASE |

Multi-frame ASE sources import the final frame. Structures without a cell
receive a centered vacuum cell. Periodic coordinates follow PQ's
origin-centered cell convention.

## Workflow

| Step | Result |
| --- | --- |
| System | Inspect coordinates, elements, periodic cells, and close contacts |
| Method | Configure molecular mechanics or one supported QM calculator |
| Conditions | Build NVE, NVT, or NPT sampling with optional NVT equilibration |
| Prepare | Wrap periodic atoms and optionally perturb perfect crystal symmetry |
| Review | Inspect every generated input before creating the package |

PQSetup does not submit jobs or run the simulation.

## Validation

PQSetup checks the structure, plan, required files, and generated inputs
locally. When the selected PQ executable advertises machine-readable
validation, PQSetup also checks the inputs with PQ.

Environment detection reports what is available. It does not establish that a
method, force field, or protocol is scientifically suitable.

PQSetup writes inputs for the stable PQ v0.7.0 release.

## Run Packages

| File | Purpose |
| --- | --- |
| `run-eq.in` | Optional NVT equilibration |
| `run-01.in` … `run-999.in` | Sampling inputs and restart chain |
| Structure restart | Prepared coordinates under the selected start filename |
| `run.sh` | Fail-fast execution in the recorded order |
| `pqproject.json` | Plan, environment, provenance, warnings, and file hashes |

Uploaded force-field files and calculator templates are included in the
package.

## Development

```bash
python -m pip install -e ".[test]"
npm --prefix frontend ci
python -m pytest
npm --prefix frontend test
npm --prefix frontend run build
```
