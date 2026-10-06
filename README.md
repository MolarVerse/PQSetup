# <img src="docs/_static/pq-logo.png" alt="PQ logo" width="48"> PQSetup

Prepare and inspect portable input packages for [PQ](https://github.com/MolarVerse/PQ) in your browser.

![PQSetup structure, method and run controls](docs/assets/screenshots/workspace.png)

## Start

Python 3.11+; PQSetup targets the stable PQ v0.7.0 input format.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install MolarVerse-PQSetup
pqsetup
```

| Step | Use |
| --- | --- |
| Structure and method | Import a structure; choose QM or MM and its required files |
| Run plan | Set ensemble, coupling, timestep and sampling length |
| Review and package | Inspect **Review** and **Inputs**, then **Package** |

The bundled water system is a vacuum demonstration. Check the physical model,
cell and sampling before research use; input validation does not establish convergence.

[Visual guide](https://molarverse.github.io/PQSetup/getting-started.html) ·
[Settings](https://molarverse.github.io/PQSetup/reference/settings.html) ·
[Validation](https://molarverse.github.io/PQSetup/validation.html) ·
[Run the package](https://molarverse.github.io/PQSetup/run-packages.html) ·
[Cluster / home VPN](https://molarverse.github.io/PQSetup/remote-access.html)
