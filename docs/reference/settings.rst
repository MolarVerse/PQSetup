Advanced settings
=================

The **Advanced** dialog in the Method section exposes the optional PQ keywords
that apply to the selected calculator or force field. Every value is written
verbatim as ``keyword = value;``; leaving a field blank keeps PQ's default and
writes nothing. The keywords in force are echoed under the button so the
Method section reads like the input file.

Only keywords accepted by the PQ v0.7.x input parsers are offered. Keywords
that exist solely on PQ's development branch (water models, ``rnoncoulomb``,
M-SHAKE, hybrid QM/MM regions) are deliberately absent.

QM calculators
--------------

.. list-table::
   :header-rows: 1
   :widths: 24 30 46

   * - Program
     - Keywords
     - Notes
   * - ASE · xTB
     - ``xtb_method``
     - GFN2-xTB (default), GFN1-xTB, IPEA1-xTB
   * - ASE · DFTB+
     - ``slakos``, ``slakos_path``, ``third_order``, ``hubbard_derivs``,
       ``dispersion``
     - ``slakos_path`` only with ``slakos = custom``; Hubbard derivatives
       require third order (PQ rejects the combination); D3 dispersion is on
       by default
   * - MACE-MP, MACE-OFF
     - ``mace_model``, ``mace_model_path``, ``mace_mode``, ``dispersion``
     - MACE-OFF offers only small/medium/large; ``mace_model_path`` only with
       ``mace_model = custom``; D3 dispersion off by default
   * - DFTB+, PySCF, Turbomole
     - ``qm_script_full_path``
     - Point PQ at a script outside its installation; replaces ``qm_script``
   * - all
     - ``remove_net_force``, ``qm_loop_time_limit``
     - Net-force removal per step; wall-time limit per QM call in seconds
       (≤ 0 = unlimited)

Molecular mechanics
-------------------

.. list-table::
   :header-rows: 1
   :widths: 24 30 46

   * - Group
     - Keywords
     - Notes
   * - Potentials
     - ``noncoulomb`` (GUFF modes), ``long_range``, ``wolf_param``,
       ``rf_epsilon``
     - ``noncoulomb``: GUFF, Lennard-Jones, Buckingham, Morse.
       ``long_range``: none, Wolf, reaction field — the reaction field needs
       ``rf_epsilon ≥ 1``
   * - Neighbour search
     - ``cell-list``, ``cell-number``
     - Cell list replaces the brute-force pair loop
   * - Constraints (topology modes)
     - ``shake``, ``shake-tolerance``, ``shake-iter``, ``rattle-tolerance``,
       ``rattle-iter``, ``distance-constraints``
     - Definitions come from the ``shake`` / ``distance_constraints`` sections
       of the topology file

Resets (any MD run)
-------------------

``nscale``, ``fscale``, ``nreset``, ``freset``, ``nreset_angular``,
``freset_angular``, ``freset_forces`` — hard temperature rescaling and
momentum / angular-momentum / net-force removal, as a number of initial steps
or an interval. Blank means never.

Keywords PQSetup manages itself
-------------------------------

``jobtype``, ``nstep``, ``timestep``, ``start_file``, ``restart_file``,
``file_prefix``, ``output_freq``, ``overwrite_output``, ``random_seed``,
``init_velocities``, ``temp``, ``start_temp``, ``temp_ramp_steps``,
``thermostat`` and its parameters, ``manostat``, ``pressure`` and its
parameters, ``isotropy``, ``qm_prog``, ``qm_script``, ``dftb_file``,
``moldescriptor_file``, ``guff_file``, ``topology_file``, ``parameter_file``,
``intra-nonbonded_file``, ``force-field``, ``rcoulomb``, ``density``,
``virial``. These come from the visible controls (``output_freq`` from
*Write every* in Output) and cannot be overridden from the dialog.

Not exposed
-----------

PQ also accepts, and PQSetup does not present: FeNNol as a calculator, the
``integrator`` choice (PQ has only velocity Verlet), per-file output names,
``dim`` and ``floating_point_type``, the ``mm-opt`` optimizer and
``mm-hessian`` controls, and the hybrid QM/MM keywords, whose names changed
after v0.7.1.
