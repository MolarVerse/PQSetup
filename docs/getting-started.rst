Getting started
===============

PQSetup prepares PQ input packages in a local browser. Install
`PQ <https://github.com/MolarVerse/PQ>`_ separately for parser validation and
execution.

You can prepare packages without a detected calculator or PQ executable. The
interface reports which validation layers ran.

Requirements
------------

* Python 3.11 or newer
* A PQ executable to validate and run the generated inputs
* The calculator and supporting files required by the chosen method

Install
-------

.. code-block:: bash

   python3 -m venv .venv
   source .venv/bin/activate
   python -m pip install MolarVerse-PQSetup

From a local clone:

.. code-block:: bash

   python -m pip install .

Node.js is only needed when changing the interface.

Open the interface
------------------

.. code-block:: bash

   pqsetup

PQSetup opens a local page at ``127.0.0.1:8888``. To choose another port or
avoid opening a browser:

.. code-block:: bash

   pqsetup serve --port 8890 --no-browser

To run PQSetup on a server or cluster and use it from your desktop, keep the
server on loopback and connect through SSH. See :doc:`remote-access` for direct,
institutional VPN and compute-node workflows.

Create the first package
------------------------

#. In **Structure**, keep the water example or import a structure or run
   folder.
#. In **Method**, choose QM with one calculator or MM with a force-field mode
   and its files.
#. In **Run**, choose NVE, NVT or NPT; set the thermodynamic conditions,
   timestep, length, and number of chained runs; then add equilibration if
   needed.
#. In **Output**, check the Review summary and every generated input, then
   press **Package** to download the ZIP.

The defaults are editable starting points, not validated production
protocols. The water example is one molecule in a vacuum cell; use an
appropriate structure and run length for research work.

Before downloading, confirm the intended calculator, ensemble, temperature or
pressure, timestep, run length, output frequency and restart order in Review.
Errors block packaging. Warnings remain visible and are written to the project
manifest. The input preview opens at the first PQ setting; **Show header**
reveals the complete run card, including the method, duration and file names.

PQSetup can export when PQ is not installed locally. In that case it reports
that PQ parser validation was unavailable. Validate on the execution machine
before a long run; see :doc:`validation`.

Check the environment
---------------------

.. code-block:: bash

   pqsetup doctor

``doctor`` reports the selected PQ executable and the external calculators
that PQSetup can detect. To use a different executable:

.. code-block:: bash

   pqsetup --pq-executable /opt/pq/bin/PQ doctor

The same path can be supplied through ``PQ_EXECUTABLE``.

Run the package
---------------

Unpack the download on the machine where PQ and the calculator are available:

.. code-block:: bash

   mkdir water-nvt
   unzip water-nvt.zip -d water-nvt
   cd water-nvt
   ./run.sh /opt/pq/bin/PQ

The launcher follows the recorded input order, writes output to ``run-logs/``,
and stops after the first failed or incomplete PQ run. Software installation,
file transfer, and scheduler submission remain under the user's control. See
:doc:`run-packages` for the archive contents and restart chain.

Next
----

* :doc:`Build a run <workflow>`
* :doc:`Use PQSetup remotely <remote-access>`
* :doc:`Understand validation <validation>`
* :doc:`Inspect the package format <run-packages>`
* :doc:`Resolve a setup problem <troubleshooting>`
