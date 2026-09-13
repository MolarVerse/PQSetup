Getting started
===============

PQSetup prepares PQ input packages in a local browser. It does not install or
run PQ. Install `PQ <https://github.com/MolarVerse/PQ>`_ separately to validate
deeply and to execute ``run.sh``.

You can design and export packages without a detected calculator or PQ
executable. Missing checks are reported instead of silently passed.

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

Create the first package
------------------------

#. Keep the water example, or import a structure.
#. Choose molecular mechanics or one QM calculator.
#. Set the sampling ensemble and duration. Add NVT equilibration if needed.
#. Review optional coordinate preparation.
#. Inspect every generated input, then create the package.

Presets are editable starting points, not validated production protocols.

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
and stops after the first failed or incomplete PQ run.

PQSetup does not submit a scheduler job. Transfer and submission remain under
the user's control.

Next
----

* :doc:`Build a run <workflow>`
* :doc:`Understand validation <validation>`
* :doc:`Inspect the package format <run-packages>`
