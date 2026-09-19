Advanced settings
=================

The **Advanced** dialog in the Method section exposes the optional PQ keywords
that apply to the selected calculator or force field. Every value is written
verbatim as ``keyword = value;``; leaving a field blank keeps PQ's default and
writes nothing. The keywords in force are echoed next to the button so the
Method section reads like the input file.

The dialog offers exactly what the PQ v0.7.x input parsers accept
(``src/input/inputFileParser/*.cpp`` and ``inputValidation.cpp`` at the
targeted release). The same table lives in ``pqsetup/keywords.py`` and drives
validation: values PQ would refuse are reported as errors before anything is
written, with the same wording PQ's parser uses for its option lists.

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
     - ``slakos = custom`` requires ``slakos_path``. PQ enables third order
       for 3ob when the key is absent and disables it otherwise; Hubbard
       derivatives (``El: value, …``) are only offered — and only accepted —
       with third order on. D3 dispersion is on by default.
   * - MACE-MP, MACE-OFF
     - ``mace_model``, ``mace_model_path``, ``mace_mode``, ``dispersion``
     - MACE-OFF ships only small/medium/large; ``mace_model = custom`` needs
       ``mace_model_path`` and the path is refused without it. ``mace_mode``:
       accurate (e3nn) or fast (cuequivariance). D3 dispersion off by default.
   * - DFTB+, PySCF, Turbomole
     - ``qm_script_full_path``
     - Runs your own script instead of the bundled ``qm_script``. The physics
       (Hamiltonian, basis, SCC settings) lives in the DFTB+ template or the
       script itself, not in the PQ input.
   * - all
     - ``remove_net_force``, ``qm_loop_time_limit``
     - Net-force removal after each call; wall-time cap per QM call in seconds
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
       ``rf_epsilon``, ``virial``
     - ``noncoulomb`` chooses how ``guff.dat`` is read: GUFF, Lennard-Jones,
       Buckingham, Morse (a parameter file declares its own type in its
       ``nonCoulombics`` header). ``long_range``: none/shifted, Wolf
       (``wolf_param ≥ 0`` Å⁻¹), reaction field (``rf_epsilon ≥ 1``).
       ``virial``: molecular (intramolecular correction from the molecule
       descriptor, default) or atomic.
   * - Neighbour search
     - ``cell-list``, ``cell-number``
     - Cell list replaces the brute-force pair loop; needs ``rcoulomb > 0``
       and is refused by PQ for pure QM runs
   * - Constraints (topology modes)
     - ``shake``, ``shake-tolerance``, ``shake-iter``, ``rattle-tolerance``,
       ``rattle-iter``, ``mshake-tolerance``, ``mshake-iter``,
       ``distance-constraints``
     - ``shake``: off, SHAKE + RATTLE (``on``), or M-SHAKE rigid bodies plus
       SHAKE (``mshake``). Choosing M-SHAKE adds a required *M-SHAKE
       geometries* file (``mshake_file``) to the Files row below, one
       reference geometry per molecule type. Bond and distance constraints
       themselves come from the topology file.

Resets (any MD run)
-------------------

``nscale``, ``fscale``, ``nreset``, ``freset``, ``nreset_angular``,
``freset_angular``, ``freset_forces`` — hard temperature rescaling and
momentum / angular-momentum / net-force removal, as a number of initial steps
or an interval. Blank means never.

What validation checks
----------------------

* Option lists (``xtb_method``, ``slakos``, ``mace_model``, ``mace_mode``,
  ``noncoulomb``, ``long_range``, ``virial``, ``shake``) and boolean tokens
  (``on``/``off``, ``true``/``false``, ``yes``/``no``).
* Ranges: tolerances > 0, iteration counts ≥ 1, ``cell-number ≥ 1``,
  ``wolf_param ≥ 0``, ``rf_epsilon ≥ 1``, reset counters ≥ 0.
* Combinations PQ's ``inputValidation.cpp`` rejects: custom Slater–Koster set
  without a path, Hubbard derivatives without third order, custom MACE model
  without a path (and a path without ``custom``), MACE-OFF with a MACE-MP-only
  model, reaction field without ``rf_epsilon``, M-SHAKE without its file, a
  cell list without a Coulomb cutoff or in a QM run.
* Spelling: ``cell-list`` and ``cell_list`` are the same keyword to PQ, so
  setting both is refused; a keyword PQSetup writes itself is refused too.

Keywords that do not apply to the current job (MM keywords in a QM run, a
calculator-specific keyword for another calculator) raise a warning; the
page strips them from the input regardless. Keywords PQSetup does not know
pass through with a warning — PQ has the final say.

Keywords PQSetup manages itself
-------------------------------

``jobtype``, ``nstep``, ``timestep``, ``start_file``, ``restart_file``,
``file_prefix``, ``output_freq``, ``overwrite_output``, ``random_seed``,
``init_velocities``, ``temp``, ``start_temp``, ``temp_ramp_steps``,
``thermostat`` and its parameters, ``manostat``, ``pressure`` and its
parameters, ``isotropy``, ``qm_prog``, ``qm_script``, ``dftb_file``,
``moldescriptor_file``, ``guff_file``, ``topology_file``, ``parameter_file``,
``intra-nonbonded_file``, ``mshake_file``, ``force-field``, ``rcoulomb``,
``density``. These come from the visible controls (``output_freq`` from
*Write every* in Output, file names from the Files row) and cannot be
overridden from the dialog.

Not exposed
-----------

PQ also accepts, and PQSetup does not present: FeNNol as a calculator
(``fennol_model_path``, ``gpu_preprocessing``), the ``integrator`` choice (PQ
has only velocity Verlet), per-file output names, ``dim`` and
``floating_point_type``, ring-polymer MD (``rpmd_n_replica``), the ``mm-opt``
optimizer and ``mm-hessian`` controls, and the hybrid QM/MM keywords, whose
names changed after v0.7.1. Water models and ``rnoncoulomb`` exist only on
PQ's development branch.
