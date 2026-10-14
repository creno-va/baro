import kr.dogfoot.hwpxlib.object.HWPXFile;
import kr.dogfoot.hwpxlib.object.content.context_hpf.Meta;
import kr.dogfoot.hwpxlib.object.content.header_xml.enumtype.LineType2;
import kr.dogfoot.hwpxlib.object.content.header_xml.references.BorderFill;
import kr.dogfoot.hwpxlib.object.content.section_xml.SectionXMLFile;
import kr.dogfoot.hwpxlib.object.content.section_xml.enumtype.*;
import kr.dogfoot.hwpxlib.object.content.section_xml.paragraph.Para;
import kr.dogfoot.hwpxlib.object.content.section_xml.paragraph.object.Table;
import kr.dogfoot.hwpxlib.object.content.section_xml.paragraph.object.table.Tc;
import kr.dogfoot.hwpxlib.object.content.section_xml.paragraph.object.table.Tr;
import kr.dogfoot.hwpxlib.reader.HWPXReader;
import kr.dogfoot.hwpxlib.tool.blankfilemaker.BlankFileMaker;
import kr.dogfoot.hwpxlib.tool.textextractor.TextExtractMethod;
import kr.dogfoot.hwpxlib.tool.textextractor.TextExtractor;
import kr.dogfoot.hwpxlib.tool.textextractor.TextMarks;
import kr.dogfoot.hwpxlib.writer.HWPXWriter;

/** A blank object tree plus synthetic paragraphs and a real 2x2 table; no input document. */
public class GenerateHwpx {
    private static void paragraph(Para para, String id, String text, boolean pageBreak) {
        para.idAnd(id).paraPrIDRefAnd("3").styleIDRefAnd("0")
                .pageBreakAnd(pageBreak).columnBreakAnd(false).merged(false);
        para.addNewRun().charPrIDRefAnd("0").addNewT().addText(text);
        para.createLineSegArray();
        para.lineSegArray().addNew().textposAnd(0).vertposAnd(0).vertsizeAnd(1000)
                .textheightAnd(1000).baselineAnd(850).spacingAnd(600)
                .horzposAnd(0).horzsizeAnd(42520).flags(393216);
    }

    public static void main(String[] args) throws Exception {
        HWPXFile file = BlankFileMaker.make();
        for (Meta meta : file.contentHPFFile().metaData().metas()) {
            if ("CreatedDate".equals(meta.name()) || "ModifiedDate".equals(meta.name())
                    || "date".equals(meta.name())) meta.text("2000-01-01T00:00:00Z");
        }
        SectionXMLFile section = file.sectionXMLFileList().get(0);
        Para first = section.getPara(0);
        first.id("1");
        first.getRun(0).addNewT().addText("합성 자료 첫째 쪽 BLUEBOX17");

        BorderFill border = file.headerXMLFile().refList().borderFills().get(0).clone();
        border.id("3");
        border.leftBorder().type(LineType2.SOLID);
        border.rightBorder().type(LineType2.SOLID);
        border.topBorder().type(LineType2.SOLID);
        border.bottomBorder().type(LineType2.SOLID);
        file.headerXMLFile().refList().borderFills().add(border);

        Table table = first.getRun(0).addNewTable();
        table.idAnd("100").zOrderAnd(0).numberingTypeAnd(NumberingType.TABLE)
                .textWrapAnd(TextWrapMethod.TOP_AND_BOTTOM).textFlowAnd(TextFlowSide.BOTH_SIDES)
                .lockAnd(false).dropcapstyleAnd(DropCapStyle.None)
                .pageBreakAnd(TablePageBreak.CELL).repeatHeaderAnd(false)
                .rowCntAnd((short) 2).colCntAnd((short) 2).cellSpacingAnd(0)
                .borderFillIDRefAnd("3").noAdjust(false);
        table.createSZ();
        table.sz().widthAnd(30000L).widthRelToAnd(WidthRelTo.ABSOLUTE)
                .heightAnd(10000L).heightRelToAnd(HeightRelTo.ABSOLUTE).protect(false);
        table.createPos();
        table.pos().treatAsCharAnd(false).affectLSpacingAnd(false).flowWithTextAnd(true)
                .allowOverlapAnd(false).holdAnchorAndSOAnd(false).vertRelToAnd(VertRelTo.PARA)
                .horzRelToAnd(HorzRelTo.COLUMN).vertAlignAnd(VertAlign.TOP)
                .horzAlignAnd(HorzAlign.LEFT).vertOffsetAnd(4000L).horzOffset(0L);
        table.createOutMargin();
        table.outMargin().leftAnd(0L).rightAnd(0L).topAnd(0L).bottom(0L);
        table.createInMargin();
        table.inMargin().leftAnd(300L).rightAnd(300L).topAnd(200L).bottom(200L);
        String[][] cells = {{"합성 표", "ORANGECIRCLE42"}, {"합성 항목", "합성 값 42"}};
        for (short row = 0; row < 2; row++) {
            Tr tr = table.addNewTr();
            for (short col = 0; col < 2; col++) {
                Tc cell = tr.addNewTc();
                cell.nameAnd("").headerAnd(false).hasMarginAnd(true).protectAnd(false)
                        .editableAnd(false).dirtyAnd(false).borderFillIDRef("3");
                cell.createCellAddr();
                cell.cellAddr().colAddrAnd(col).rowAddr(row);
                cell.createCellSpan();
                cell.cellSpan().colSpanAnd((short) 1).rowSpan((short) 1);
                cell.createCellSz();
                cell.cellSz().widthAnd(15000L).height(5000L);
                cell.createCellMargin();
                cell.cellMargin().leftAnd(300L).rightAnd(300L).topAnd(200L).bottom(200L);
                cell.createSubList();
                cell.subList().idAnd("").textDirectionAnd(TextDirection.HORIZONTAL)
                        .lineWrapAnd(LineWrapMethod.BREAK).vertAlignAnd(VerticalAlign2.CENTER)
                        .linkListIDRefAnd("0").linkListNextIDRefAnd("0").textWidthAnd(0)
                        .textHeightAnd(0).hasTextRefAnd(false).hasNumRef(false);
                paragraph(cell.subList().addNewPara(), Integer.toString(10 + row * 2 + col), cells[row][col], false);
            }
        }
        paragraph(section.addNewPara(), "2", "합성 자료 둘째 쪽 END_NATIVE_DOCUMENT", true);
        HWPXWriter.toFilepath(file, args[0]);

        HWPXFile read = HWPXReader.fromFilepath(args[0]);
        if (read.sectionXMLFileList().count() != 1
                || read.sectionXMLFileList().get(0).countOfPara() != 2
                || !read.sectionXMLFileList().get(0).getPara(1).pageBreak()) {
            throw new IllegalStateException("Synthetic page-break structure changed");
        }
        String text = TextExtractor.extract(read, TextExtractMethod.InsertControlTextBetweenParagraphText, false, new TextMarks());
        for (String marker : new String[]{"합성 자료 첫째 쪽", "BLUEBOX17", "합성 표", "ORANGECIRCLE42", "합성 자료 둘째 쪽", "END_NATIVE_DOCUMENT"}) {
            if (!text.contains(marker)) throw new IllegalStateException("Synthetic marker missing");
        }
    }
}
