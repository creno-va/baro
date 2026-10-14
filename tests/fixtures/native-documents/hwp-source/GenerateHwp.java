import java.lang.reflect.Method;
import kr.dogfoot.hwplib.object.HWPFile;
import kr.dogfoot.hwplib.object.bodytext.Section;
import kr.dogfoot.hwplib.object.bodytext.control.Control;
import kr.dogfoot.hwplib.object.bodytext.control.ControlTable;
import kr.dogfoot.hwplib.object.bodytext.paragraph.Paragraph;
import kr.dogfoot.hwplib.object.bodytext.paragraph.lineseg.LineSegItem;
import kr.dogfoot.hwplib.reader.HWPReader;
import kr.dogfoot.hwplib.tool.blankfilemaker.BlankFileMaker;
import kr.dogfoot.hwplib.tool.textextractor.TextExtractMethod;
import kr.dogfoot.hwplib.tool.textextractor.TextExtractor;
import kr.dogfoot.hwplib.writer.HWPWriter;

/** Own synthetic content; the pinned upstream sample contributes table-building code only. */
public class GenerateHwp {
    public static void main(String[] args) throws Exception {
        HWPFile file = BlankFileMaker.make();
        file.getScripts().setDefaultJScript(null);
        file.getScripts().setJScriptVersion(null);
        Section section = file.getBodyText().getSectionList().get(0);
        Paragraph first = section.getParagraph(0);
        first.getText().addString("합성 자료 첫째 쪽 BLUEBOX17");

        // Invoke construction directly. Its main(), HWPReader and sample input are never used.
        Class<?> sample = Class.forName("sample.Inserting_Table");
        Method makeTable = sample.getDeclaredMethod("makeTable", HWPFile.class);
        makeTable.setAccessible(true);
        makeTable.invoke(sample.getDeclaredConstructor().newInstance(), file);
        ControlTable table = null;
        for (Control control : first.getControlList()) {
            if (control instanceof ControlTable) table = (ControlTable) control;
        }
        if (table == null) throw new IllegalStateException("Synthetic table missing");
        String[][] cells = {{"합성 표", "ORANGECIRCLE42"}, {"합성 항목", "합성 값 42"}};
        for (int row = 0; row < 2; row++) {
            for (int col = 0; col < 2; col++) {
                Paragraph paragraph = table.getRowList().get(row).getCellList().get(col)
                        .getParagraphList().getParagraph(0);
                paragraph.getText().getCharList().clear();
                paragraph.getText().addString(cells[row][col]);
            }
        }
        Paragraph second = section.addNewParagraph();
        second.getHeader().setParaShapeId(3);
        second.getHeader().setStyleId((short) 0);
        second.getHeader().getDivideSort().setDividePage(true);
        second.createText();
        second.getText().addString("합성 자료 둘째 쪽 END_NATIVE_DOCUMENT");
        second.createCharShape();
        second.getCharShape().addParaCharShape(0, 0);
        second.createLineSeg();
        LineSegItem line = second.getLineSeg().addNewLineSegItem();
        line.setTextStartPosition(0);
        line.setLineVerticalPosition(0);
        line.setLineHeight(1000);
        line.setTextPartHeight(1000);
        line.setDistanceBaseLineToLineVerticalPosition(850);
        line.setLineSpace(600);
        line.setStartPositionFromColumn(0);
        line.setSegmentWidth(42520);
        line.getTag().setValue(393216);
        HWPWriter.toFile(file, args[0]);

        HWPFile read = HWPReader.fromFile(args[0]);
        if (read.getBodyText().getSectionList().size() != 1
                || read.getBodyText().getSectionList().get(0).getParagraphCount() != 2
                || !read.getBodyText().getSectionList().get(0).getParagraph(1)
                    .getHeader().getDivideSort().isDividePage()) {
            throw new IllegalStateException("Synthetic page-break structure changed");
        }
        String text = TextExtractor.extract(read, TextExtractMethod.InsertControlTextBetweenParagraphText);
        for (String marker : new String[]{"합성 자료 첫째 쪽", "BLUEBOX17", "합성 표", "ORANGECIRCLE42", "합성 자료 둘째 쪽", "END_NATIVE_DOCUMENT"}) {
            if (!text.contains(marker)) throw new IllegalStateException("Synthetic marker missing");
        }
        if (text.contains("왼쪽") || text.contains("오른쪽")) {
            throw new IllegalStateException("Upstream example text was not replaced");
        }
    }
}
