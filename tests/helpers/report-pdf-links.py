"""Read-only exact URI/action/rectangle/font validation for synthetic PDF tests."""
import io,json,sys
from pypdf import PdfReader
reader=PdfReader(io.BytesIO(sys.stdin.buffer.read()))
expected=json.loads(sys.argv[1]); found=[]; rectangles=0
for page in reader.pages:
    box=page.mediabox
    for ref in page.get('/Annots', []):
        annotation=ref.get_object(); action=annotation.get('/A', {})
        assert annotation.get('/Subtype') == '/Link'
        assert action.get('/S') == '/URI' and str(action.get('/URI')) in expected
        assert not any(key in annotation for key in ('/AA','/JS','/Dest','/FS'))
        x1,y1,x2,y2=map(float,annotation['/Rect'])
        # PDF rectangles may specify either diagonal; WeasyPrint uses top/bottom.
        x1,x2=sorted((x1,x2)); y1,y2=sorted((y1,y2))
        assert float(box.left) <= x1 < x2 <= float(box.right)
        assert float(box.bottom) <= y1 < y2 <= float(box.top)
        found.append(str(action['/URI'])); rectangles+=1
    assert len(page.extract_text()) > 50
    assert any('/ToUnicode' in ref.get_object() for ref in page['/Resources']['/Font'].values())
assert set(found)==set(expected), (found,expected)
assert '/OpenAction' not in reader.trailer['/Root'] and '/AA' not in reader.trailer['/Root']
print(json.dumps({'urls': sorted(set(found)), 'annotations':rectangles,'pages':len(reader.pages),'rectanglesWithinPages':True,'unicodeFont':True}))
