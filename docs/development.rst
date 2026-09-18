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
     input_writer.py        SimulationSetup → PQ input text + validation
     run_plan.py            equilibration / chained runs, effective setup
     setup_files.py         which companion files a method needs
     structures.py          structure import, wrapping, generated cells
     models.py              Pydantic models shared with the frontend types
   frontend/
     src/                   PQSetup page (React + Vite + TypeScript)
       App.tsx              the setup page: Structure · Method · Run · Output
       components/          PQSetup-specific widgets
       effectiveSetup.ts    strips hidden state before rendering
       method.ts, calculatorSettings.ts, runPlan.ts   domain rules
     packages/pq-design/    the shared design language (see below)

Two rules shape the frontend:

Top to bottom
   A control may only change what is below it. ``effectiveSetup`` is the
   single place that maps the remembered form state onto what is visible, so
   a hidden field never reaches the input file.

No duplication
   A view exists once — inline *or* in a dialog — and explanatory text lives
   in ``Info`` tooltips, not beside the controls.

Shared design language
----------------------

``frontend/packages/pq-design`` is the ``@molarverse/pq-design`` workspace
package: the flat-mono theme (IBM Carbon Gray 10 palette, IBM Plex Mono,
square corners, hairline dividers) as tokens, base styles, and React
primitives. PQViewer and PQEnalyzer are meant to consume the same package so
the PQ tools look and behave alike.

.. code-block:: text

   tokens.json          single source of truth: colours, type, spacing, shape
   src/styles/
     tokens.css         generated:  npm --prefix frontend run tokens
     base.css           reset, typography, focus ring, status glyphs
     components.css     styles of the primitives and their class names
   src/
     Modal  Info  Field  Choice  Toggle  Group  ConditionRow  CommandPalette

Consuming it from another Vite + React app:

.. code-block:: json

   { "dependencies": { "@molarverse/pq-design": "file:../PQSetup/frontend/packages/pq-design" } }

.. code-block:: ts

   import "@molarverse/pq-design/styles.css";
   import { ConditionRow, Field, Info, Modal } from "@molarverse/pq-design";

Python front ends read ``tokens.json`` directly:

.. code-block:: python

   tokens = json.loads(Path("tokens.json").read_text())
   accent = tokens["color"]["accent"]

To change the language edit ``tokens.json`` and regenerate ``tokens.css``, or
add a primitive together with its rules in ``components.css``. Class names in
``components.css`` are public API for every tool. The package README lists the
rules of the language.

Checking against PQ
-------------------

``pqsetup/release.py`` names the PQ release the writer targets. The advanced
keywords in ``calculatorSettings.ts`` and the generated keys in
``input_writer.py`` are cross-checked against PQ's ``src/input`` parsers of
that release; a keyword that only exists on PQ's development branch is not
offered. ``tests/test_pq_integration.py`` runs the exported package against a
local PQ build when one is available.
