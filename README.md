# PQSetup

PQSetup prepares validated, reproducible inputs for PQ simulations.

It combines a guided run protocol, structure checks, calculator diagnostics,
and readable input previews in one local application.

PQSetup currently targets the input schema of PQ v0.6.4. It detects and shows
the version of the selected PQ executable separately.

## Development

Requires Python 3.11 or newer and Node.js 20 or newer.

```bash
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
npm --prefix frontend install
npm --prefix frontend run build
.venv/bin/pqsetup
```

The application opens locally in the default browser. It does not submit or
run a simulation.

## Command line

```bash
pqsetup
pqsetup doctor
pqsetup validate run.in
pqsetup serve --no-browser
```

Set a non-standard PQ executable with `PQ_EXECUTABLE` or
`--pq-executable /path/to/PQ`.

## Scientific behavior

- The ambient NPT preset starts at 298.15 K and 1.01325 bar.
- Coupling hints use PQ v0.6.4 defaults; compressibility remains material-specific.
- NVT and NPT expose every thermostat and method-specific control in PQ v0.6.4.
- NPT exposes both manostats, relaxation, compressibility, and cell response.
- Sampling can follow an NVT equilibration and be split into linked runs.
- Run-plan inputs use optional `run-eq.in`, then `run-01.in` through `run-99.in`.
- Each protocol uses one PQ calculator.
- Missing PQ or calculator installations warn without blocking input creation.
- Velocity initialization is delegated to PQ through `init_velocities`.
- Position perturbations are Gaussian, seeded, reversible, and revalidated.
- Cell-less molecules receive a centered vacuum cell with 6 Å padding.
- NPT requires a physical periodic cell; generated vacuum cells are rejected.
- Non-zero molecule types are rejected until companion force-field files are supported.
- Collision checks use periodic minimum-image distances.
- Calculator choices are limited to methods in the targeted PQ release.
