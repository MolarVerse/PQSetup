# Changelog

PQSetup follows [Semantic Versioning](https://semver.org/). This file records
user-visible changes.

## [0.5.0] - 2026-11-23

### Added

- Add shared navigation, Help and health checks, and monitor run progress from the browser.

### Added

- Open PQSetup from a phone through a private reverse proxy while the server stays on loopback.

### Fixed

- Keep structure details readable above touch-friendly file actions on phones.

## [0.4.0] - 2026-11-20

### Changed

- Target the stable PQ v1.1.0 input format (was v0.7.0). Advanced settings
  are checked against the v1.1.0 parsers.
- Turbomole runs use PQ's `turbomole_ricc2` script (renamed from
  `turbomole_rimp2`); `turbomole_ricc2.py` is offered as well.

### Added

- Water models for MM runs (`water_intra`, `water_inter`, `rnoncoulomb`) in
  the Advanced dialog; a water model needs a `water_type` line in the
  molecule descriptor.
- *Fixed axes* (`fixed_axis`) under NPT pressure coupling, limited to the
  out-of-plane axis for semi-isotropic coupling.
- *File writing* (`async_output`) in Output to write MD files before the next
  step instead of on a background thread.

### Fixed

- Third-order ASE DFTB+ with matsci or custom parameters now needs Hubbard
  derivatives, as PQ 1.1 requires.
- `rpmd_n_replica` must be at least 2, matching PQ.

## [0.3.0] - 2026-11-17

### Added

- The setup page remembers the current setup in the browser and restores it
  after a refresh; **Reset** starts clean.
- Importing an exported run folder restores the run plan from
  `pqproject.json` (calculator, ensemble, steps, run count, equilibration,
  seed, name) and states what was imported.
- `run.sh` checks that the calculator's Python modules (ASE, MACE, PySCF) are
  found before PQ starts and names the missing module; `--skip-check` skips
  this.
- `run.sh` stops when outputs of an earlier attempt are present and lists
  them; `./run.sh --fresh` moves them into `attempt-N/` and starts again.

### Fixed

- Read the capability report of PQ 1.0 and later (schema 2), so parser
  validation works again with an installed PQ 1.x. A PQ with a newer, unknown
  schema is still used, and the setup page, `pqsetup doctor` and
  `pqsetup validate` say why its parser check is off.
- Set up rigid GUFF water as in PQ's `h2o_mm-mshake` example: constraints and
  M-SHAKE are offered with `force-field = off`, the topology and M-SHAKE files
  are packed and named in the input, and an empty topology file is accepted.
  Dropped `*.top` files are recognised as topologies.

## [0.2.5] - 2026-10-06

### Changed

- Consume PQDesign 0.1.3 for shared terminal help, startup identity and colors.
- Report structure loading, perturbation, project exports, request errors and
  shutdown; keep polling and static requests quiet at the default log level.
- Add `--log-level` for server events.
- Keep scientific data processing imports out of help, version and environment
  checks.

### Fixed

- Open the browser only after the application and listener are ready. Report
  occupied ports without opening a browser.

## [0.2.4] - 2026-10-02

### Changed

- Consume the standalone `@molarverse/pq-design` 0.1.2 release and keep its
  source, tests, and release workflow in the PQDesign repository.

### Fixed

- Reject ports outside the usable TCP range before starting the local server.

## [0.2.3] - 2026-09-28

### Fixed

- Compile the shared design controls with the automatic JSX runtime so the
  setup page renders in the browser. Verify a React control from the packed
  archive before publishing the design package.

## [0.2.2] - 2026-09-28

### Changed

- Restore the generated input run card, section styling and preview controls
  while retaining the validation and setup-state refactors.
- Expand the getting-started, validation, troubleshooting and run-package
  documentation around the complete prepare-to-run flow.
- Build the shared flat mono design package as an independently installable
  archive with JavaScript, TypeScript declarations, CSS and tokens.

## [0.2.1] - 2026-09-28

### Changed

- Keep the setup page at Structure on first load and identify the bundled
  single-water structure as a vacuum example.
- Surface the xTB electronic model, initial velocity choice, simulation random
  seed and output frequency in the main flow; keep the Structure jitter seed
  separate.
- Add an Output review of the structure, method, duration, velocities,
  temperature and write frequency, with direct links to blocking issues.
- Show generated inputs from the first PQ keyword while retaining the complete
  file on demand; show a clear unavailable state for invalid inputs.
- Fit the 3D structure view to atoms by default and offer a separate cell fit.

### Fixed

- Require an imported physical periodic cell for QM NPT instead of accepting
  the bundled vacuum example.
- Respect disabled velocity initialization in the first equilibration stage.

## [0.2.0] - 2026-09-19

### Changed

- Redesigned interface: one page with Structure, Method, Run and Output
  sections in a flat monospaced theme (IBM Carbon Gray 10 palette). Settings
  only ever affect what is below them; hidden controls never reach the input.
- Run conditions are independent rows (Temperature with optional ramp,
  Pressure, Steps with chained runs, Equilibration).
- Generated inputs carry a readable header with the plan in plain words.
- The QM molecule-descriptor slot appears only when the structure carries
  molecule types; `moldescriptor_file` is written only when a descriptor is
  packed, for any ensemble.

### Added

- Advanced settings dialog exposing the optional PQ keywords per calculator
  and force field, echoed under the button in input-file form.
- Folder and multi-file import that sorts companion files by name.
- 3D structure viewer with a rotating axis triad.
- Command palette (Ctrl+K or `/`) with problems, sections and actions.
- `@molarverse/pq-design`: the shared design language as a workspace package
  (tokens, base styles, React primitives) for PQViewer and PQEnalyzer.
- `pqsetup/keywords.py`: one table of the optional PQ keywords with the
  values, ranges and combinations the v0.7.x parsers accept. Advanced
  settings are checked against it (option lists, bounds, custom Slater–Koster
  and MACE paths, Hubbard derivatives without third order, reaction field
  without `rf_epsilon`, cell lists in QM runs, duplicate spellings); keywords
  that do not apply to the current job warn.
- SHAKE/RATTLE and distance constraints for QM runs (to move the timestep
  past 0.5 fs); switching them on adds the topology slot under Method › Files.
- M-SHAKE constraints (`shake = mshake`, `mshake-tolerance`, `mshake-iter`)
  with the required `mshake_file` slot appearing under Method › Files.
- `virial = molecular | atomic` in the MM advanced settings.
- Kinetic resets (`nscale`, `fscale`, `nreset`, `freset`, `nreset_angular`,
  `freset_angular`, `freset_forces`) under Run › Steps › Resets: PQ applies
  them in the MD engine for every runner. Temperature rescaling is offered
  for NVT/NPT only.

### Removed

- Keywords absent from the PQ v0.7.x parsers: `water_intra`, `water_inter`,
  `rnoncoulomb`. Dispersion is offered for ASE DFTB+ and MACE, no longer for
  xTB where PQ ignores it.

## [0.1.0] - 2026-09-13

Initial public alpha.

### Added

- Local browser interface for preparing PQ simulation inputs
- CIF, XYZ, PDB, MOL, SDF, ASE trajectory, and PQ restart imports
- Molecular mechanics and supported external QM calculator setup
- NVE, NVT, and NPT run planning with optional equilibration
- Local validation with optional validation by a compatible PQ executable
- Portable run packages with ordered inputs, launcher, provenance, and hashes
- Reproducible coordinate wrapping and optional seeded perturbation
