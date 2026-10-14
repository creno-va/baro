"""Convert only this directory's authored OOXML fixtures, offline in the image.

Inputs: /document-fixtures. Outputs: /tmp/baro-generated-legacy. Uses the same
installed LibreOffice as the product; output is a synthetic fixture, not a user
document. No external input, personal paths, macros or remote references.
"""
from pathlib import Path
import subprocess
import tempfile
import time

import uno
from com.sun.star.beans import PropertyValue


def prop(name, value):
    result = PropertyValue()
    result.Name, result.Value = name, value
    return result


output = Path("/tmp/baro-generated-legacy")
output.mkdir()
with tempfile.TemporaryDirectory(prefix="baro-author-legacy-") as temporary:
    connection = "pipe,name=baro_synthetic_author;urp;StarOffice.ComponentContext"
    process = subprocess.Popen(["soffice", "--headless", "--nologo", "--nodefault", "--norestore",
                                "-env:UserInstallation=" + Path(temporary).as_uri(), "--accept=" + connection],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    desktop = None
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        deadline = time.monotonic() + 15
        while True:
            try:
                context = resolver.resolve("uno:" + connection)
                break
            except Exception:
                if process.poll() is not None or time.monotonic() >= deadline:
                    raise RuntimeError("Synthetic fixture desktop unavailable") from None
                time.sleep(.05)
        desktop = context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        for source, suffix, filter_name in (
            ("office-two-pages.docx", "doc", "MS Word 97"),
            ("office-two-sheets.xlsx", "xls", "MS Excel 97"),
            ("office-two-slides.pptx", "ppt", "MS PowerPoint 97"),
        ):
            document = desktop.loadComponentFromURL((Path("/document-fixtures") / source).as_uri(), "_blank", 0,
                        (prop("Hidden", True), prop("MacroExecutionMode", uno.Any("short", 0)),
                         prop("UpdateDocMode", uno.Any("short", 0))))
            assert document is not None
            try:
                target = output / Path(source).with_suffix("." + suffix).name
                document.storeToURL(target.as_uri(), (prop("FilterName", filter_name), prop("Overwrite", False)))
                if suffix == "doc":
                    document.storeToURL((output / "encrypted.docx").as_uri(),
                        (prop("FilterName", "Office Open XML Text"), prop("Password", "synthetic-fixture-only")))
                if suffix == "xls":
                    document.Sheets.getByIndex(0).protect("synthetic-fixture-only")
                    document.storeToURL((output / "protected.xls").as_uri(), (prop("FilterName", filter_name),))
            finally:
                document.close(True)
    finally:
        if desktop is not None:
            desktop.terminate()
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
print("Authored legacy Office fixtures: 3; encrypted/protected controls: 2")
