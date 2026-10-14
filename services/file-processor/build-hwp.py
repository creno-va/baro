"""Build-time patches to pinned upstream H2Orestart v0.7.14.

Keep upstream source/license in the image; fail closed if a pin changes shape.
No document is ever opened by this build tool.
"""
from pathlib import Path
import sys

root = Path(sys.argv[1])
source = root / "source/ebandal/libreoffice/comp/H2OrestartImpl.java"
text = source.read_text()
start = text.index("    private void initialLogger() {")
end = text.index("    private void cleanTmpFolder() {", start)
text = text[:start] + """    private void initialLogger() {
        rootLogger = Logger.getLogger(\"\");
        for (Handler handler: rootLogger.getHandlers()) {
            rootLogger.removeHandler(handler);
            handler.close();
        }
        rootLogger.setLevel(Level.OFF);
        // Still needed for embedded images, but confined to invocation XDG cache.
        writerContext.userHomeDir = getAppCachePath();
        try {
            Files.createDirectories(writerContext.userHomeDir);
        } catch (IOException e) {
            throw new IllegalStateException(\"PRIVATE_DIRECTORY_UNAVAILABLE\");
        }
    }

""" + text[end:]
source.write_text(text)
source = root / "source/HwpDoc/HwpxFile.java"
text = source.read_text()
original = "DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();"
assert text.count(original) == 1
source.write_text(text.replace(original, original + """
        factory.setFeature(\"http://apache.org/xml/features/disallow-doctype-decl\", true);
        factory.setFeature(\"http://xml.org/sax/features/external-general-entities\", false);
        factory.setFeature(\"http://xml.org/sax/features/external-parameter-entities\", false);
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, \"\");
        factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_SCHEMA, \"\");
"""))
