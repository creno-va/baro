"""Private UNO conversion child. No untrusted stdout/stderr or interactive UI."""
import os
from pathlib import Path
import resource
import subprocess
import sys
import time
import uuid

import uno
from com.sun.star.beans import PropertyValue


def property_value(name, value):
    prop = PropertyValue()
    prop.Name, prop.Value = name, value
    return prop


def convert(root, fmt):
    # Per-file output, CPU and descriptor bounds are inherited by the native
    # converter; outer Container memory/process/time bounds remain in force.
    resource.setrlimit(resource.RLIMIT_FSIZE, (100_000_000, 100_000_000))
    resource.setrlimit(resource.RLIMIT_CPU, (100, 100))
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
    filters = {"doc": "MS Word 97", "docx": "Office Open XML Text",
               "xls": "MS Excel 97", "xlsx": "Calc MS Excel 2007 XML",
               "ppt": "MS PowerPoint 97", "pptx": "Impress MS PowerPoint 2007 XML",
               "hwp": "Hwp2002_File", "hwpx": "Hwp2002_File"}
    if fmt not in filters:
        return 2
    root = root.resolve(strict=True)
    name = "baro_" + uuid.uuid4().hex
    connection = "pipe,name=" + name + ";urp;StarOffice.ComponentContext"
    office = subprocess.Popen(["soffice", "--headless", "--nologo", "--nodefault",
                               "--norestore", "--invisible", "-env:UserInstallation=" + (root / "office-profile").as_uri(),
                               "--accept=" + connection], stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    document = desktop = None
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        deadline = time.monotonic() + 15
        while True:
            try:
                context = resolver.resolve("uno:" + connection)
                break
            except Exception:
                if office.poll() is not None or time.monotonic() >= deadline:
                    return 1
                time.sleep(.05)
        desktop = context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        # MacroExecMode.NEVER_EXECUTE=0 and UpdateDocMode.NO_UPDATE=0 are
        # explicit UNO loading policies, independent of extension/default prefs.
        document = desktop.loadComponentFromURL((root / "input").as_uri(), "_blank", 0, tuple(
            property_value(key, value) for key, value in (
                ("Hidden", True), ("ReadOnly", True), ("MacroExecutionMode", uno.Any("short", 0)),
                ("UpdateDocMode", uno.Any("short", 0)), ("Silent", True),
                ("FilterName", filters[fmt]))))
        if document is None:
            return 2
        if fmt in {"xls", "xlsx"}:
            sheets = document.Sheets
            if sheets.getCount() > 20_000:
                return 2
            if document.isProtected() or any(sheets.getByIndex(index).isProtected()
                                             for index in range(sheets.getCount())):
                return 2
        export = "calc_pdf_Export" if fmt in {"xls", "xlsx"} else "impress_pdf_Export" if fmt in {"ppt", "pptx"} else "writer_pdf_Export"
        document.storeToURL((root / "normalized.pdf").as_uri(), tuple(
            property_value(key, value) for key, value in (
                ("FilterName", export), ("Overwrite", False),
                ("FilterData", tuple(property_value(key, value) for key, value in (
                    ("ExportFormFields", False), ("ExportLinksRelativeFsys", False),
                    ("ExportBookmarks", False), ("ExportNotes", False),
                    ("IsAddStream", False)))))))
        return 0
    finally:
        if document is not None:
            try:
                document.close(True)
            except Exception:
                pass
        if desktop is not None:
            try:
                desktop.terminate()
            except Exception:
                pass
        if office.poll() is None:
            office.terminate()
        try:
            office.wait(timeout=5)
        except subprocess.TimeoutExpired:
            office.kill()
            office.wait(timeout=5)


if __name__ == "__main__":
    try:
        result = convert(Path(sys.argv[1]), sys.argv[2])
    except Exception:
        result = 1
    sys.exit(result)
