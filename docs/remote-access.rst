Remote access
=============

PQSetup can run beside PQ and its calculators on a server while you use the
browser on your desktop. Keep the HTTP server on its default loopback address;
the SSH tunnel provides access without exposing PQSetup to the network.

Direct SSH
----------

On the server, activate the environment containing PQSetup and start it without
opening a remote browser:

.. code-block:: bash

   pqsetup serve --no-browser --port 8888

Keep that command running. In a second terminal on your desktop, open the
tunnel:

.. code-block:: bash

   ssh -N -o ExitOnForwardFailure=yes \
     -L 127.0.0.1:8888:127.0.0.1:8888 user@server

Then open ``http://localhost:8888`` on the desktop. Keep the SSH command
running while you use PQSetup. ``ExitOnForwardFailure`` reports a failure to
create the local listener; it does not verify that PQSetup is healthy on the
server.

Work from home through the institutional VPN
--------------------------------------------

#. Connect to the institutional VPN.
#. Confirm the server is reachable with ``ssh user@server``. If this fails,
   resolve the VPN, DNS or SSH access problem before starting a tunnel.
#. Start PQSetup on the server with the command above.
#. Run the same tunnel command from the desktop and open
   ``http://localhost:8888``.

If the VPN disconnects, reconnect it and run the tunnel command again. The
PQSetup process must still be running on the server.

Login node and compute node
---------------------------

When PQSetup runs on a compute node inside an active allocation, start it on
that compute node:

.. code-block:: bash

   pqsetup serve --no-browser --port 8888

If the site permits SSH to compute nodes through a login node, run this on the
desktop:

.. code-block:: bash

   ssh -N -o ExitOnForwardFailure=yes -J user@login.cluster \
     -L 127.0.0.1:8888:127.0.0.1:8888 user@compute-node

The SSH destination must be the node hosting PQSetup. Forwarding to the login
node does not reach an app bound to a compute node's loopback interface. Keep
the allocation, PQSetup process and tunnel alive. Follow the site's access
policy when direct SSH to compute nodes is not permitted.

Files and environment
---------------------

PQSetup runs in the remote process. Command-line paths, ``PATH``,
``PQ_EXECUTABLE``, saved configuration and calculator discovery therefore
refer to the server or compute node. The browser still runs on the desktop:
files selected in it are uploaded through the encrypted tunnel for processing,
and downloaded run packages return to the desktop.

Troubleshooting
---------------

* If ``ssh user@server`` fails from home, check the VPN connection, institutional
  DNS and routes, then the SSH host name and account.
* If local port 8888 is occupied, keep PQSetup on remote port 8888 and use a
  different desktop port:

  .. code-block:: bash

     ssh -N -o ExitOnForwardFailure=yes \
       -L 127.0.0.1:18888:127.0.0.1:8888 user@server

  Open ``http://localhost:18888``.
* If the tunnel starts but the page does not load, confirm PQSetup is still
  running on the SSH destination and that the command uses the node hosting
  the app. A successful local forward does not prove remote app health.
* After a VPN interruption, reconnect the VPN and restart the SSH tunnel.
