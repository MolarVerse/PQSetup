.. _validation:

Validation
==========

PQSetup separates local checks, environment discovery, and PQ parser
validation. The interface states which layers actually ran.

Local preflight
---------------

Local checks run while the setup is edited. They cover:

* readable structure data, finite coordinates, and known elements;
* periodic-cell geometry and PQ's centered wrapping convention;
* unusually close atom pairs using ASE covalent radii;
* ensemble and coupling parameters;
* required calculator, topology, parameter, and template files;
* restart names and generated-input consistency.

The close-contact scan is a bounded geometric heuristic. It reports up to 200
contacts and does not establish bonding, protonation, or chemical correctness.

Environment discovery
---------------------

``pqsetup doctor`` and the Method step inspect PQ and supported external
calculators. A detected executable means that the command or package was found
and its setup appears complete enough for input generation.

Discovery does not run a reference energy, force, or dynamics calculation.
Warnings may therefore accompany an export that is intended for another
machine.

PQ parser validation
--------------------

When a selected PQ executable advertises validation schema v1, PQSetup calls
PQ's own parser:

.. list-table::
   :header-rows: 1
   :widths: 30 20 50

   * - Context
     - Scope
     - Purpose
   * - Package preview and export
     - ``portable``
     - Check syntax and release-level input support without requiring the local
       calculator
   * - ``pqsetup validate run.in``
     - ``installed``
     - Check syntax and the capabilities of the installed PQ build

PQSetup discovers this support through ``PQ --capabilities=json``. Builds
without the contract continue to receive local checks, and the missing PQ
validation is reported explicitly.

What validation does not prove
------------------------------

Passing preflight does not prove:

* that the model chemistry or force field is appropriate;
* that the timestep and coupling constants are stable;
* that equilibration or sampling is long enough;
* that the vacuum or periodic cell is converged;
* that the structure has the intended bonding, charge, spin, or protonation;
* that a detected calculator will produce scientifically meaningful results.

Treat every preset as a starting template. Review the generated inputs and test
the protocol on the intended execution environment.

Validate an existing input
--------------------------

.. code-block:: bash

   pqsetup validate run.in

Use ``--json`` for structured diagnostics:

.. code-block:: bash

   pqsetup validate --json run.in

An explicitly configured but unusable PQ executable is an error. A PQ build
that does not advertise installed validation produces a warning after local
checks.
