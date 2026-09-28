Shared design package
=====================

``@molarverse/pq-design`` supplies the flat mono tokens, CSS and React
controls used by PQSetup. PQViewer and PQEnalyzer Web can install the same
versioned package without a sibling PQSetup checkout. The package is released
as a public GitHub asset, so an npm registry account is not required.

Install in a web frontend
-------------------------

From the consumer's frontend directory:

.. code-block:: bash

   npm install "https://github.com/MolarVerse/PQSetup/releases/download/pq-design-v0.1.0/molarverse-pq-design-0.1.0.tgz"

Commit ``package.json`` and ``package-lock.json``. ``npm ci`` then installs the
same package version in CI and on another machine. React 19 and Lucide are peer
dependencies; the consuming app supplies them.

.. code-block:: tsx

   import "@molarverse/pq-design/styles.css";
   import { Field, Modal } from "@molarverse/pq-design";

Import the shared CSS before the app's layout CSS. The package sets the
palette, font, focus treatment and common control styles. Keep product-specific
layout rules in the consuming app. ``tokens.css`` and ``tokens.json`` are also
exported for consumers that only need the palette.

Change the shared design
------------------------

The source lives in ``frontend/packages/pq-design``. Edit ``tokens.json`` for
shared values and regenerate the CSS with ``npm --prefix frontend run tokens``.
Put reusable React controls in that package, with their styles in
``src/styles/components.css``. Build and test from the PQSetup checkout:

.. code-block:: bash

   npm --prefix frontend ci
   npm --prefix frontend test
   npm --prefix frontend run build

Changes to exported components, tokens or public class names require a design
package version bump. Tag the verified commit ``pq-design-v<version>`` to build
the installable archive and its checksums. Consumer repositories then update
the archive URL and lockfile together. PQSetup's Python release number is
separate from the design package version.
