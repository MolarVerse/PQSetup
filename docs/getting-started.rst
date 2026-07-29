Getting started
===============

PQSetup is currently a pre-release project installed from source. The
graphical interface and its static assets are included in the Python package.

Requirements
------------

* Python 3.11 or newer
* A PQ executable to validate and run the generated inputs
* The calculator and supporting files required by the chosen method

You can design and export portable inputs without a detected calculator or PQ
executable. PQSetup reports the missing checks instead of silently passing
them.

Install
-------

.. code-block:: bash

   git clone https://github.com/MolarVerse/PQSetup.git
   cd PQSetup
   python3 -m venv .venv
   source .venv/bin/activate
   python -m pip install .

Node.js is only needed when changing the interface.

Check the environment
---------------------

.. code-block:: bash

   pqsetup doctor

``doctor`` reports the selected PQ executable and the external calculators
that PQSetup can detect. To use a different executable:

.. code-block:: bash

   pqsetup --pq-executable /opt/pq/bin/PQ doctor

The same path can be supplied through ``PQ_EXECUTABLE``.

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

#. Import a structure, or keep the water example.
#. Choose molecular mechanics or one QM calculator.
#. Set the sampling ensemble and duration. Add NVT equilibration if needed.
#. Review optional coordinate preparation.
#. Inspect every generated input, then create the package.

Presets are editable starting points, not validated production protocols.
Check the timestep, duration, coupling constants, method, and system size for
the actual scientific question.

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
