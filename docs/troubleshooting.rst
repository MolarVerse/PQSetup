Troubleshooting
===============

Start in **Output → Review**. It lists blocking errors and warnings for the
current structure, method and run plan. Select an issue to jump to the
relevant control; the input preview is unavailable until the blocking errors
are resolved.

Package is disabled
-------------------

Check the issue count beside **Package** and resolve every error in Review.
Common causes are a missing structure or method file, an invalid run value,
or a generated restart name that collides with an input file. If you changed
the interaction model or ensemble, review the visible fields again: PQSetup
remembers earlier choices but writes only settings that apply to the current
selection.

PQ is not local
---------------

PQSetup can prepare a package without PQ. Local preflight still runs, but PQ
parser validation is unavailable and is reported as such. On the machine that
will run the simulation, inspect the environment and validate an input:

.. code-block:: bash

   pqsetup --pq-executable /path/to/PQ doctor
   pqsetup --pq-executable /path/to/PQ validate run-01.in

If that PQ build does not advertise the parser validation contract, PQSetup
reports that limit. Review the inputs and test a short run with the intended
calculator before committing to a long simulation.

Calculator or companion file is missing
---------------------------------------

The Method section reports local calculator discovery and shows the file slots
required by the selected program or force field. Add the required topology,
force-field or template files before packaging. A calculator that will only be
available on another machine cannot be executed or scientifically checked by
this machine; check it again at the destination with ``pqsetup doctor``.

The downloaded package does not run
-----------------------------------

Extract the ZIP before running ``run.sh``. Supply an executable PQ path, then
inspect the log for the first failed input in ``run-logs/``:

.. code-block:: bash

   unzip water-nvt.zip -d water-nvt
   cd water-nvt
   ./run.sh /path/to/PQ

The launcher stops at the first non-zero PQ exit or when PQ does not print its
normal completion marker. It does not install PQ or the selected calculator.
See :doc:`run-packages` for the input order and archive contents.

If a problem persists, include the PQSetup version, the selected PQ build,
the Review message and a minimal input when `opening an issue
<https://github.com/MolarVerse/PQSetup/issues>`_. Remove private structure or
path data before sharing the files.
