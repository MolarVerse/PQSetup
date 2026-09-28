Shared design package
=====================

``@molarverse/pq-design`` supplies the flat mono tokens, CSS and React
controls used by PQSetup. Its source, CI and releases live in the public
`PQDesign repository <https://github.com/MolarVerse/PQDesign>`_. PQViewer and
PQEnalyzer Web install the same versioned package without a sibling checkout.

Install in a web frontend
-------------------------

From the consumer's frontend directory:

.. code-block:: bash

   npm install "https://github.com/MolarVerse/PQDesign/releases/download/v0.1.2/molarverse-pq-design-0.1.2.tgz"

Commit ``package.json`` and ``package-lock.json``. ``npm ci`` then installs the
same package version in CI and on another machine. React 19 and Lucide are peer
dependencies; the consuming app supplies them.

Choose the import that matches the UI:

* For shared React controls, import ``styles.css`` before the app's layout CSS.
  It includes tokens, base styles, and component rules.
* For an app with its own controls, import only ``tokens.css``. For example,
  PQViewer keeps its viewer dialogs and toolbars while using the common palette.
  The full stylesheet has unscoped class selectors such as
  ``.command-palette`` and ``.notice`` that can affect unrelated components
  with the same names.

.. code-block:: tsx

   // App using shared controls, such as PQEnalyzer Web
   import "@molarverse/pq-design/styles.css";
   import { Field, Modal } from "@molarverse/pq-design";

.. code-block:: tsx

   // App using its own controls, such as PQViewer
   import "@molarverse/pq-design/tokens.css";
   import "./viewer.css";

Keep product-specific layout rules in the consuming app. ``tokens.json`` is
also exported for non-CSS consumers. The CSS font stack prefers IBM Plex Mono;
apps that need that exact face must supply its font files.

Change the shared design
------------------------

Edit the `PQDesign repository <https://github.com/MolarVerse/PQDesign>`_.
``tokens.json`` is the source for the generated CSS. Reusable React controls
and their styles live there too. Build and test from that checkout:

.. code-block:: bash

   npm ci
   npm run tokens
   npm test
   npm run build

Changes to exported components, tokens or public class names require a design
package version bump. Tag the verified commit ``v<version>`` in PQDesign to build
the installable archive and its checksums. Consumer repositories then update
the archive URL and lockfile together. PQSetup's Python release number is
separate from the design package version.
