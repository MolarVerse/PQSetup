Compatibility
=============

PQ inputs
---------

PQSetup currently writes inputs for the stable PQ v0.6.4 schema. It does not
expose unreleased keywords merely because they exist on a development branch.

.. list-table::
   :header-rows: 1
   :widths: 30 32 38

   * - Selected PQ executable
     - Input generation
     - PQ parser validation
   * - Advertises validation schema v1
     - Available
     - ``portable`` during export and ``installed`` from the CLI
   * - Does not advertise the validation contract
     - Available for v0.6.4 inputs
     - Not run; local checks remain active
   * - Not detected
     - Portable export remains available
     - Not run; the missing executable is reported

Calculator availability is reported separately from PQ parser support.

Structure formats
-----------------

.. list-table::
   :header-rows: 1
   :widths: 27 23 50

   * - Format
     - Extension
     - Notes
   * - PQ restart
     - ``.rst``
     - Preserves atom names, molecule types, and available velocities or forces
   * - CIF
     - ``.cif``
     - Read through ASE
   * - XYZ / extended XYZ
     - ``.xyz``, ``.extxyz``
     - A centered vacuum cell is generated when no cell is present
   * - Protein Data Bank
     - ``.pdb``
     - Read through ASE
   * - MOL / SDF
     - ``.mol``, ``.sdf``
     - Read through ASE
   * - ASE trajectory
     - ``.traj``
     - The final frame is imported

Uploads are limited to 100 MB.

Generated cells
---------------

PQ uses a cell centered on the origin. PQSetup therefore wraps periodic
coordinates into fractional coordinates from −0.5 to +0.5, equivalent to −L/2
to +L/2 for an orthorhombic cell.

For a structure without a cell, the import and preparation model:

#. centers the coordinate bounds on the origin;
#. adds 6 Å of padding on each side;
#. assigns a diagonal periodic cell;
#. records the generated-cell provenance in ``pqproject.json``.

QM exports retain this generated cell. MM exports omit the generated ``Box`` and
write the configured density to the PQ input instead.

QM NPT setup requires an imported physical cell; a generated vacuum cell is not
accepted for that workflow.

Platform notes
--------------

The local interface is Python-based and does not require Node.js at runtime.
Exported launchers require Bash. Calculator and PQ platform support still
depends on the selected external software.
