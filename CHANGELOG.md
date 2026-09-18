# Changelog

PQSetup follows [Semantic Versioning](https://semver.org/). This file records
user-visible changes.

## [Unreleased]

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
- Validation of keyword combinations PQ rejects (Hubbard derivatives without
  third order, reaction field without `rf_epsilon`).

### Removed

- Keywords absent from the PQ v0.7.x parsers: `water_intra`, `water_inter`,
  `rnoncoulomb`, `shake = mshake`. Dispersion is offered for ASE DFTB+ and
  MACE, no longer for xTB where PQ ignores it.

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
