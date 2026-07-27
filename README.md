# PQSetup

PQSetup prepares validated, reproducible inputs for PQ simulations.

It combines guided scientific presets, structure checks, runner diagnostics,
and a readable input preview in one local application.

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

- Ambient NPT uses 298.15 K and 1.01325 bar.
- Velocity initialization is delegated to PQ through `init_velocities`.
- Position perturbations are Gaussian, seeded, reversible, and revalidated.
- Cell-less molecules receive a centered vacuum cell with 6 Å padding.
- NPT requires a physical periodic cell; generated vacuum cells are rejected.
- Non-zero molecule types are rejected until companion force-field files are supported.
- Collision checks use periodic minimum-image distances.
- Runner probes do not start a calculation.
