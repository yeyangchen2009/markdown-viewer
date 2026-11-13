#!/usr/bin/env python3
"""Overlay local sources on the matching upstream release without rebuilding legacy native dependencies."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("release_zip", type=Path)
    parser.add_argument("--browser", choices=("chrome", "firefox"), default="chrome")
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    unpacked = args.work_dir.resolve() / "unpacked"
    if unpacked.exists():
        shutil.rmtree(unpacked)
    unpacked.mkdir(parents=True)
    with zipfile.ZipFile(args.release_zip) as archive:
        assert archive.testzip() is None, "upstream release ZIP failed CRC validation"
        archive.extractall(unpacked)

    source = unpacked / "markdown-viewer"
    with (source / "manifest.json").open(encoding="utf-8") as handle:
        release_manifest = json.load(handle)
    with (ROOT / f"manifest.{args.browser}.json").open(encoding="utf-8") as handle:
        local_manifest = json.load(handle)
    assert release_manifest["version"] == local_manifest["version"], "release/source version mismatch"

    output = args.output.resolve()
    if output.exists():
        shutil.rmtree(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, output)
    for directory in ("background", "content", "icons", "options", "popup"):
        shutil.copytree(ROOT / directory, output / directory, dirs_exist_ok=True)
    shutil.copy2(ROOT / f"manifest.{args.browser}.json", output / "manifest.json")

    archive_path = output.parent / f"{output.name}-v{local_manifest['version']}-editor.zip"
    files = sorted(path for path in output.rglob("*") if path.is_file())
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(output).as_posix())
    with zipfile.ZipFile(archive_path) as archive:
        assert archive.testzip() is None, "output ZIP failed CRC validation"
        assert set(archive.namelist()) == {
            path.relative_to(output).as_posix() for path in files
        }, "output ZIP file set mismatch"

    digest = hashlib.sha256(archive_path.read_bytes()).hexdigest()
    print(f"directory={output}")
    print(f"archive={archive_path}")
    print(f"files={len(files)} bytes={archive_path.stat().st_size} sha256={digest}")


if __name__ == "__main__":
    main()
