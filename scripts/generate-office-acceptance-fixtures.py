#!/usr/bin/env python3
"""Generate small synthetic Office files for the development acceptance suite."""

import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

import uno
from com.sun.star.beans import PropertyValue


def libreoffice_env(root: Path) -> dict[str, str]:
    runtime = root / "runtime"
    cache = root / "cache"
    runtime.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    return dict(os.environ, XDG_RUNTIME_DIR=str(runtime), XDG_CACHE_HOME=str(cache))


def convert(source: Path, target_type: str, output: Path, profile: Path, env: dict[str, str]) -> None:
    subprocess.run(
        [
            "/usr/bin/libreoffice",
            f"-env:UserInstallation={profile.as_uri()}",
            "--headless",
            "--convert-to",
            target_type,
            "--outdir",
            str(output),
            str(source),
        ],
        check=True,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=30,
    )


def available_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def create_presentation(output: Path, profile: Path, env: dict[str, str]) -> None:
    port = available_port()
    process = subprocess.Popen(
        [
            "/usr/bin/libreoffice",
            f"-env:UserInstallation={profile.as_uri()}",
            "--headless",
            f"--accept=socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext",
            "--norestore",
            "--nodefault",
        ],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        local_context = uno.getComponentContext()
        resolver = local_context.ServiceManager.createInstanceWithContext(
            "com.sun.star.bridge.UnoUrlResolver", local_context
        )
        context = None
        for _ in range(60):
            try:
                context = resolver.resolve(
                    f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
                )
                break
            except Exception:
                time.sleep(0.1)
        if context is None:
            raise RuntimeError("LibreOffice UNO connection failed")
        desktop = context.ServiceManager.createInstanceWithContext(
            "com.sun.star.frame.Desktop", context
        )
        document = desktop.loadComponentFromURL("private:factory/simpress", "_blank", 0, ())
        slide = document.getDrawPages().getByIndex(0)
        shape = document.createInstance("com.sun.star.drawing.TextShape")
        shape.Position = uno.createUnoStruct("com.sun.star.awt.Point", 2000, 2000)
        shape.Size = uno.createUnoStruct("com.sun.star.awt.Size", 22000, 5000)
        shape.String = "عرض قبول Tahili صناعي وآمن"
        slide.add(shape)
        prop = PropertyValue()
        prop.Name = "FilterName"
        prop.Value = "Impress MS PowerPoint 2007 XML"
        document.storeAsURL(uno.systemPathToFileUrl(str(output / "tahili-qa-office.pptx")), (prop,))
        document.close(True)
    finally:
        process.terminate()
        process.wait(timeout=10)


def main() -> None:
    if len(sys.argv) > 1:
        output = Path(sys.argv[1]).resolve()
        if output.parent != Path("/tmp") or not output.name.startswith("tahili-office-fixtures-"):
            raise ValueError("output must be a new /tmp/tahili-office-fixtures-* directory")
        if output.exists():
            raise FileExistsError(f"refusing to replace existing output: {output}")
        output.mkdir(mode=0o700)
    else:
        output = Path(tempfile.mkdtemp(prefix="tahili-office-fixtures-", dir="/tmp"))
    work = output / ".generator"
    work.mkdir()
    text = work / "tahili-qa-office.txt"
    csv = work / "tahili-qa-office.csv"
    text.write_text("مستند قبول Tahili صناعي وآمن\n", encoding="utf-8")
    csv.write_text("العنصر,القيمة\nقبول,١\n", encoding="utf-8")
    env = libreoffice_env(work)
    convert(text, "docx", output, work / "profile-docx", env)
    convert(csv, "xlsx", output, work / "profile-xlsx", env)
    create_presentation(output, work / "profile-pptx", env)
    shutil.rmtree(work)


if __name__ == "__main__":
    main()
