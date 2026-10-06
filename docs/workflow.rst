.. _workflow:

Build a run
===========

PQSetup follows one direction: **Structure**, **Method**, **Run**, then
**Output**. The table below is the control map; detailed scientific and format
rules live in the linked references.

Control map
-----------

.. list-table::
   :header-rows: 1
   :widths: 16 39 45

   * - Area
     - Task
     - Check
   * - Structure
     - Import a structure or run folder; inspect it in **3D**; optionally apply
       seeded **Jitter**.
     - Confirm formula, atom count, cell, and close-contact warnings. A
       generated vacuum cell cannot be used for NPT.
   * - Method
     - Choose QM or MM, select the calculator or force-field mode, and add the
       files shown under **Files**.
     - Detection reports software availability. It is not an energy, force, or
       dynamics calculation.
   * - Run
     - Set the ensemble, initial velocities, coupling, timestep, sampling
       length, chained runs, resets, and optional equilibration.
     - Check that the physical protocol and total duration suit the system.
   * - Output
     - Set the package name and output frequency; inspect **Review** and every
       tab under **Inputs**.
     - Errors block packaging. Warnings are recorded in ``pqproject.json``.

Scientific checks
-----------------

* The bundled water structure is one molecule in a generated vacuum cell.
* Imported trajectories use their final frame; the original file is unchanged.
* Generated cells use 6 Å of padding and are preparation aids, not convergence
  evidence.
* A hydrogen-containing structure above a 0.5 fs timestep is flagged for
  review.
* More than one sampling run creates ``run-01.in`` through ``run-NN.in``;
  equilibration adds ``run-eq.in`` first.

Reference pages
---------------

* :doc:`reference/compatibility` lists structure formats, cell rules,
  calculators, and platform support.
* :doc:`reference/settings` lists optional PQ keywords, constraints, and
  kinetic resets.
* :doc:`validation` explains local preflight, environment discovery, PQ parser
  validation, and what those checks cannot prove.
* :doc:`run-packages` documents the archive, manifest, restart order, and
  launcher.

Shortcuts
---------

.. list-table::
   :header-rows: 1
   :widths: 65 35

   * - Action
     - Shortcut
   * - Search settings and issues
     - :kbd:`Ctrl+K` / :kbd:`Cmd+K` or :kbd:`/`
   * - Jump to Structure, Method, Run, or Inputs
     - :kbd:`Alt+1` through :kbd:`Alt+4`
   * - Create the package
     - :kbd:`Ctrl+Enter` / :kbd:`Cmd+Enter`
   * - Close a dialog or search
     - :kbd:`Esc`
