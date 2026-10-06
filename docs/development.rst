Development
===========

PQSetup is a Python package that serves a prebuilt single-page interface.
Users need Python only; the interface is rebuilt with Node.js when it changes.

.. code-block:: bash

   python -m pip install -e ".[test,docs]"
   npm --prefix frontend ci
   python -m pytest
   npm --prefix frontend test
   npm --prefix frontend run build      # writes pqsetup/static/
   sphinx-build -b html docs docs/_build

For live editing run the API and the Vite dev server side by side; Vite
proxies ``/api`` to the Python process:

.. code-block:: bash

   pqsetup serve --no-browser                 # 127.0.0.1:8888
   npm --prefix frontend run dev              # 127.0.0.1:5173

Layout
------

.. code-block:: text

   pqsetup/                 Python: FastAPI app, CLI, PQ knowledge
     api.py                 HTTP endpoints, export packaging
     input_writer.py        SimulationSetup → PQ input text
     input_presentation.py  generated input header and comment styling
     validation.py          setup and input-file validation
     run_plan.py            equilibration / chained runs, effective setup
     setup_files.py         which companion files a method needs
     structures.py          structure import, wrapping, generated cells
     models.py              Pydantic models shared with the frontend types
   frontend/
     src/                   PQSetup page (React + Vite + TypeScript)
       App.tsx              the setup page: Structure · Method · Run · Output
       setupState.ts         example, defaults, setup updates
       droppedFiles.ts       file and folder drop handling
       components/          PQSetup-specific widgets
       effectiveSetup.ts    strips hidden state before rendering
       method.ts, calculatorSettings.ts, runPlan.ts   domain rules

Two rules shape the frontend:

Top to bottom
   A control may only change what is below it. ``effectiveSetup`` is the
   single place that maps the remembered form state onto what is visible, so
   a hidden field never reaches the input file.

Progressive detail
   The setup page keeps the main choices inline. Advanced settings live in
   dialogs, and the generated input can be expanded to read the full file.

Shared design language
----------------------

The flat mono theme lives in the separate
`PQDesign repository <https://github.com/MolarVerse/PQDesign>`_. PQSetup pins
its public archive in ``frontend/package-lock.json``. Changes to shared
tokens, CSS or React controls are made and released there; see
:doc:`design-system` for the consumer integration rules. Keep PQSetup layout
and product behavior in this repository.

Checking against PQ
-------------------

``pqsetup/release.py`` names the PQ release the writer targets.
``pqsetup/keywords.py`` lists every optional keyword the dialog may write
with the values, bounds and combinations PQ's ``src/input`` parsers of that
release accept; ``calculatorSettings.ts`` mirrors it for the UI and the
generated keys in ``input_writer.py`` are kept out of it. When PQ moves, edit
the table (and the frontend option lists) rather than the validator. A
keyword that only exists on PQ's development branch is not offered.
``tests/test_pq_integration.py`` runs the exported package against a local PQ
build when one is available.
