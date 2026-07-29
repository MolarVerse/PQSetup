Command line
============

Open the interface
------------------

Running ``pqsetup`` without a subcommand starts the local interface.

.. code-block:: bash

   pqsetup
   pqsetup serve --host 127.0.0.1 --port 8888
   pqsetup serve --no-browser

The server only accepts ``127.0.0.1`` or ``localhost``.

Inspect the environment
-----------------------

.. code-block:: bash

   pqsetup doctor
   pqsetup doctor --json

``doctor`` exits with ``0`` when PQ is found and ``1`` when it is not found.

Validate an input
-----------------

.. code-block:: bash

   pqsetup validate run.in
   pqsetup validate --json run.in

Exit status:

.. list-table::
   :header-rows: 1
   :widths: 15 85

   * - Status
     - Meaning
   * - ``0``
     - Available checks passed
   * - ``1``
     - Local or PQ validation reported an invalid input
   * - ``2``
     - PQ validation could not run because of an explicit configuration or
       probe error

Select a PQ executable
----------------------

The global option works before the subcommand:

.. code-block:: bash

   pqsetup --pq-executable /opt/pq/bin/PQ doctor
   pqsetup --pq-executable /opt/pq/bin/PQ validate run.in
   pqsetup --pq-executable /opt/pq/bin/PQ serve

PQSetup resolves the executable in this order:

#. ``--pq-executable``
#. the saved PQSetup configuration
#. ``PQ_EXECUTABLE``
#. ``PQ`` or ``pq`` on ``PATH``
#. a nearby PQ development build, when present

The saved configuration lives at ``$XDG_CONFIG_HOME/pqsetup/config.json``, or
``~/.config/pqsetup/config.json`` when ``XDG_CONFIG_HOME`` is unset.

Version
-------

.. code-block:: bash

   pqsetup --version
