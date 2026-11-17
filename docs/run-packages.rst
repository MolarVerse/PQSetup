.. _run-packages:

Run packages
============

PQSetup exports a self-contained ZIP archive. After extracting it into a
project directory, a continued NVT plan with equilibration can look like this:

.. code-block:: text

   water-nvt/
   ├── run-eq.in
   ├── run-01.in
   ├── run-02.in
   ├── run-03.in
   ├── water-example.rst
   ├── run.sh
   └── pqproject.json

Required force-field files or calculator templates are included when the
method needs them.

Restart order
-------------

The input sequence is explicit:

.. code-block:: text

   run-eq.in → run-01.in → run-02.in → run-03.in

Each input writes the restart consumed by the next stage. Filenames use ``eq``
for equilibration and zero-padded sampling indices up to ``999``.

Run launcher
------------

``run.sh`` is an executable Bash script that reads the recorded execution
order. Supply the PQ executable as an argument:

.. code-block:: bash

   ./run.sh /opt/pq/bin/PQ

You can also set it once:

.. code-block:: bash

   PQ_EXECUTABLE=/opt/pq/bin/PQ ./run.sh

The script:

#. resolves and checks the executable;
#. checks that the Python modules the calculator imports are found
   (``ase`` for the ASE calculators, ``ase`` and ``mace`` for MACE through
   ``python3``, ``pyscf`` through ``python``);
#. stops if outputs of an earlier attempt are in the folder;
#. runs each input in order;
#. writes one log per input under ``run-logs/``;
#. stops at the first non-zero exit or missing ``PQ ended normally`` marker.

It does not submit a scheduler job. Nothing is run when a check fails.

PQ starts its embedded Python from the ``python3`` on ``PATH`` and reads
``PYTHONPATH``, so activate the calculator environment before ``./run.sh``.
If PQ is built against a different Python, skip the module check with
``./run.sh --skip-check``.

Retry after a failure
---------------------

PQ does not overwrite the outputs of an earlier attempt. After fixing the
cause, start again in the same folder with:

.. code-block:: bash

   ./run.sh --fresh /opt/pq/bin/PQ

``--fresh`` moves the earlier logs and PQ outputs into ``attempt-1/``
(``attempt-2/`` next time) and runs the plan from the start. It deletes
nothing.

Project manifest
----------------

``pqproject.json`` records:

* the PQSetup version and target PQ release;
* the scientific plan and execution order;
* input, structure, setup-file, and run-script SHA-256 hashes;
* structure and preparation provenance;
* the PQ build, calculator readiness, and method availability seen during
  export;
* warnings and the result of each PQ validation layer.

The manifest is the machine-readable record. The input header is a readable
summary for people reviewing individual ``.in`` files; it does not replace
the manifest or change PQ settings.

Move to another machine
-----------------------

The package is designed to be transferred to the machine that has the required
PQ build and calculator. Re-run environment checks there before a long
simulation:

.. code-block:: bash

   pqsetup --pq-executable /cluster/apps/PQ doctor
   pqsetup --pq-executable /cluster/apps/PQ validate run-01.in

``pqsetup validate`` requires PQSetup on that machine. The packaged ``run.sh``
only requires Bash, PQ, the selected calculator and its runtime dependencies.
Use the launcher directly or call it from the site's scheduler script.
