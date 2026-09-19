.. _workflow:

Build a run
===========

The setup is one page with four sections that read top to bottom: Structure,
Method, Run, Output. Every generated input is rendered live in the Output
section as the settings change.

.. admonition:: One direction

   A setting only ever changes what is *below* it. Choosing NPT never adds a
   file to Method, and importing a structure never rewrites a run name you
   typed. What you have already read stays true as you scroll down.

Structure
---------

Import ``.rst``, ``.cif``, ``.xyz``, ``.extxyz``, ``.pdb``, ``.mol``,
``.sdf``, or ``.traj``, or drop a file on the page. For a multi-frame
trajectory, PQSetup imports the final frame.

**Folder** imports a whole run directory: the structure and its companion
files (molecule descriptor, GUFF table, topology, parameters, DFTB+ template)
are sorted by name and land in the right slots. Dropping several files at
once does the same.

**3D** opens the structure in a viewer with a rotating axis triad; the same
viewer is not repeated inline.

The structure pass checks finite coordinates, element labels, the periodic
cell, and unusually close contacts. Periodic coordinates are wrapped to
fractional coordinates from −0.5 to +0.5 (−L/2 to +L/2 for an orthorhombic
cell). The original file is not modified.

Structures without a cell receive an orthorhombic cell with 6 Å of padding on
each side. That generated cell is a convenient vacuum boundary, not a claim
that the chosen dimensions are physically converged. A generated cell cannot
be used for NPT.

**Jitter** applies a seeded Gaussian perturbation to every position, useful to
break the exact symmetry of a perfect crystal. The same seed reproduces the
same coordinates. Changing the width or seed after applying shows an *apply
again* hint instead of silently reverting.

Method
------

Choose **QM** or **MM**.

QM
   Pick a *Program* (DFTB+, ASE · DFTB+, ASE · xTB, PySCF, Turbomole, MACE-MP,
   MACE-OFF). Programs PQ drives through a script (DFTB+, PySCF, Turbomole)
   also offer a *Method* list read from the installed scripts. PQSetup shows
   whether each program was detected; that is a discovery check, not an
   energy calculation, and a portable package can still be prepared for
   another machine.

MM
   Pick the force-field mode: *GUFF*, *bonded + GUFF*, or *force field*, and
   set the Coulomb cutoff and, for a generated cell, the density.

**Advanced** opens the optional PQ keywords for the selected calculator or
force field (see :doc:`reference/settings`); run-level extras such as
kinetic resets live under Run › Steps instead. Keywords in force are listed
under the button exactly as they will appear in the input file, e.g.
``xtb_method = gfn1-xtb;``. Switching program or interaction model keeps your
choices in memory, but only the keywords that apply to the current selection
reach the input.

**Files** lists the companion files the selection needs, each with an *Add
file* / *Added* state. MM always needs a molecule descriptor plus the GUFF,
topology, or parameter files of its mode; choosing M-SHAKE under Advanced
adds the geometry file it reads. For QM the row shows the template a
program needs, a topology when Advanced switches on SHAKE or distance
constraints (the usual way to run a QM timestep above 0.5 fs), and a molecule
descriptor **only when the structure carries molecule types** in its ``.rst``
— PQ reads the descriptor exactly then, so the slot follows the structure, not
the ensemble.

Run
---

Pick the ensemble — **NVE**, **NVT**, or **NPT** — then work down the rows.
Each row owns one physical concern and is independent of the others.

Temperature
   Target, thermostat and its parameters. *Start K* and *Ramp steps* define
   an optional linear temperature ramp inside the sampling run.

Pressure
   NPT only: target pressure, manostat (PQ's word for the barostat),
   relaxation time, compressibility and how the cell may respond
   (isotropic … fully anisotropic).

Steps
   Sampling steps, timestep and *Runs*. More than one run writes a numbered
   restart chain (``run-01.in`` … ``run-NN.in``) where every input reads the
   previous restart. A hydrogen-containing structure with a timestep above
   0.5 fs is flagged. **Advanced** holds PQ's kinetic resets (hard temperature
   rescaling for NVT/NPT, momentum / angular-momentum / net-force removal),
   echoed next to the button like the method keywords.

Equilibration
   An optional NVT stage written as ``run-eq.in`` that runs before sampling
   with its own steps, timestep, temperature and thermostat. Sampling starts
   from its restart file, velocities included.

.. figure:: assets/screenshots/run-plan.png
   :alt: PQSetup Run section with equilibration and three sampling runs
   :class: pq-shot
   :align: center

   NVT with an equilibration stage and three chained sampling runs.

Velocities are initialized by PQ at runtime from the temperature and random
seed PQSetup writes.

Output
------

**Package** sets the run name (derived from the structure until you edit it)
and how often PQ writes output. **Inputs** shows one tab per generated input
with the complete text, syntax-coloured; the expand button opens it full size.
The header of every input identifies PQSetup, the target PQ release and the
plan in plain words.

.. figure:: assets/screenshots/input-review.png
   :alt: PQSetup Output section with the generated inputs
   :class: pq-shot
   :align: center

   Four inputs: the equilibration stage and three sampling runs.

The footer shows the package name, the number of inputs, and the count of
open issues. Errors block **Package**; click the issue to jump to the control
that caused it. Warnings remain visible and are recorded in the manifest. The
line under the inputs is the launch command to run after unpacking.

Search and shortcuts
--------------------

.. list-table::
   :header-rows: 1
   :widths: 65 35

   * - Action
     - Shortcut
   * - Search settings, problems, and actions
     - :kbd:`Ctrl+K` / :kbd:`Cmd+K` or :kbd:`/`
   * - Jump to Structure · Method · Run · Inputs
     - :kbd:`Alt+1` … :kbd:`Alt+4`
   * - Create the package
     - :kbd:`Ctrl+Enter` / :kbd:`Cmd+Enter`
   * - Close a dialog or the search
     - :kbd:`Esc`
