from __future__ import annotations

import argparse
import json
import re
import tarfile
from email.parser import BytesParser
from pathlib import Path
from zipfile import ZipFile


DISTRIBUTION_NAME = "MolarVerse-PQSetup"


def verify_wheel(path: Path) -> None:
    with ZipFile(path) as archive:
        names = set(archive.namelist())
        metadata_path = next(
            (name for name in names if name.endswith(".dist-info/METADATA")),
            None,
        )
        if metadata_path is None:
            raise SystemExit("wheel has no package metadata")

        metadata = BytesParser().parsebytes(archive.read(metadata_path))
        if metadata["Name"] != DISTRIBUTION_NAME:
            raise SystemExit(f"unexpected distribution name: {metadata['Name']}")

        required = (
            "pqsetup/static/index.html",
            "pqsetup/static/pq-logo.png",
        )
        for bundled_file in required:
            if bundled_file not in names:
                raise SystemExit(f"wheel is missing {bundled_file}")

        notice_paths: dict[str, str] = {}
        for notice in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
            notice_path = next(
                (
                    name
                    for name in names
                    if name.endswith(f".dist-info/licenses/{notice}")
                ),
                None,
            )
            if notice_path is None:
                raise SystemExit(f"wheel is missing {notice}")
            notice_paths[notice] = notice_path

        lockfile = json.loads(Path("frontend/package-lock.json").read_text())
        # Workspace packages (our own code, linked into node_modules) and the
        # root entry are not third parties and need no notice.
        runtime_packages = {
            name.rsplit("node_modules/", 1)[-1]
            for name, package in lockfile["packages"].items()
            if "node_modules/" in name
            and not package.get("dev", False)
            and not package.get("link", False)
        }
        notices = archive.read(notice_paths["THIRD_PARTY_NOTICES.md"]).decode()
        undocumented = {
            package for package in runtime_packages if f"`{package}`" not in notices
        }
        if undocumented:
            missing = ", ".join(sorted(undocumented))
            raise SystemExit(f"third-party notices are missing: {missing}")

        html = archive.read("pqsetup/static/index.html").decode()
        for asset in re.findall(r'(?:src|href)="(/assets/[^"?]+)', html):
            bundled = f"pqsetup/static{asset}"
            if bundled not in names:
                raise SystemExit(f"wheel is missing {bundled}")


def verify_sdist(path: Path) -> None:
    with tarfile.open(path, "r:gz") as archive:
        names = archive.getnames()
    for required in (
        "README.md",
        "CHANGELOG.md",
        "THIRD_PARTY_NOTICES.md",
        "docs/conf.py",
        "frontend/package-lock.json",
        "frontend/src/App.tsx",
    ):
        if not any(name.endswith(f"/{required}") for name in names):
            raise SystemExit(f"source archive is missing {required}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("wheel", type=Path)
    parser.add_argument("sdist", type=Path)
    arguments = parser.parse_args()
    verify_wheel(arguments.wheel)
    verify_sdist(arguments.sdist)


if __name__ == "__main__":
    main()
