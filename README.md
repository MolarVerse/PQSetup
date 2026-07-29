<img src="https://raw.githubusercontent.com/MolarVerse/PQSetup/main/frontend/public/pq-logo.png" alt="PQSetup logo" width="200">

[![CI](https://github.com/MolarVerse/PQSetup/actions/workflows/ci.yml/badge.svg)](https://github.com/MolarVerse/PQSetup/actions/workflows/ci.yml)
[![Docs](https://github.com/MolarVerse/PQSetup/actions/workflows/docs.yml/badge.svg)](https://molarverse.github.io/PQSetup/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# PQSetup

Prepare and validate PQ simulation inputs in a local browser interface.

## Install

PQSetup is currently installed from source and requires Python 3.11 or newer.

```bash
git clone https://github.com/MolarVerse/PQSetup.git
cd PQSetup
python3 -m venv .venv
source .venv/bin/activate
python -m pip install .
```

The interface is included in the Python package. Node.js is not required.

## Quick Start

Open the graphical interface:

```bash
pqsetup
```

Inspect the selected PQ executable and available calculators:

```bash
pqsetup doctor
```

Use a PQ executable with a different name or location:

```bash
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

PQSetup targets the stable PQ v0.6.4 input schema.

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
python -m pip install -e ".[dev]"
npm --prefix frontend ci
python -m pytest
npm --prefix frontend test
npm --prefix frontend run build
```
