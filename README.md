<img src="https://raw.githubusercontent.com/MolarVerse/PQSetup/main/frontend/public/pq-logo.png" alt="PQSetup logo" width="200">

[![CI](https://github.com/MolarVerse/PQSetup/actions/workflows/ci.yml/badge.svg)](https://github.com/MolarVerse/PQSetup/actions/workflows/ci.yml)
[![Docs](https://github.com/MolarVerse/PQSetup/actions/workflows/docs.yml/badge.svg)](https://molarverse.github.io/PQSetup/)
[![PyPI](https://img.shields.io/pypi/v/molarverse-pqsetup.svg)](https://pypi.org/project/molarverse-pqsetup/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

# PQSetup

Prepare and validate PQ simulation inputs in a local browser interface.

PQSetup builds the input package. [PQ](https://github.com/MolarVerse/PQ) runs it.

[Documentation](https://molarverse.github.io/PQSetup/)

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

PQSetup does not submit jobs or run the simulation. It writes inputs for the
stable PQ v0.7.0 release.

## Documentation

- [Getting started](https://molarverse.github.io/PQSetup/getting-started.html) —
  install, environment checks, and the first run package
- [Build a run](https://molarverse.github.io/PQSetup/workflow.html) —
  Structure, Method, Run, Output, and keyboard shortcuts
- [Validation](https://molarverse.github.io/PQSetup/validation.html) — local
  preflight, environment discovery, and PQ parser checks
- [Run packages](https://molarverse.github.io/PQSetup/run-packages.html) —
  package layout, restart order, and the project manifest
- [Command line](https://molarverse.github.io/PQSetup/reference/cli.html) —
  `serve`, `doctor`, and `validate`
- [Compatibility](https://molarverse.github.io/PQSetup/reference/compatibility.html)
  — supported structure formats, cells, and calculators
- [Advanced settings](https://molarverse.github.io/PQSetup/reference/settings.html)
  — the optional PQ keywords per calculator and force field
- [Troubleshooting](https://molarverse.github.io/PQSetup/troubleshooting.html)
  — blocked packages, missing PQ and runtime failures
- [Shared design package](https://molarverse.github.io/PQSetup/design-system.html)
  — versioned tokens, CSS and React controls for other PQ web tools

## Development

```bash
python -m pip install -e ".[test]"
npm --prefix frontend ci
python -m pytest
npm --prefix frontend test
npm --prefix frontend run build
```

The interface uses [`@molarverse/pq-design`](https://github.com/MolarVerse/PQDesign),
the shared design package for the PQ web tools. The frontend locks a public
release archive in `package-lock.json` and needs no sibling checkout.
