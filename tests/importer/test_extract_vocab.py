from __future__ import annotations

import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from xml.sax.saxutils import escape
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("extract_vocab", ROOT / "scripts/extract_vocab.py")
importer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = importer
SPEC.loader.exec_module(importer)


def fixture(path: Path, *, header_row=5, russian="ёлка / йод", target="A10", duplicate=False):
    from PIL import Image
    image = Image.new("RGB", (20, 30), "white")
    buffer = io.BytesIO()
    image.save(buffer, "PNG")

    def row(n, values, formula_col=None):
        cells = []
        for i, value in enumerate(values):
            letter = chr(65 + i)
            formula = f'<x:f>{escape(formula_col[1])}</x:f>' if formula_col and i == formula_col[0] else ""
            cells.append(f'<x:c r="{letter}{n}" t="str">{formula}<x:v>{escape(str(value))}</x:v></x:c>')
        return f'<x:row r="{n}">{"".join(cells)}</x:row>'

    xml_begin = f'<x:worksheet xmlns:x="{importer.NS["x"]}" xmlns:r="{importer.NS["r"]}"><x:sheetData>'
    values = ["1", "1", "3、9", russian, "树；碘", "", "10", "12", "查看原表", "册末生词表", "", "ёлка / йод"]
    formula = f'IFERROR(HYPERLINK("#\'原表图像\'!{target}","查看原表"),"查看原表")'
    main = xml_begin + row(header_row, importer.FIELDS) + row(header_row + 1, values, (8, formula))
    if duplicate:
        main += row(header_row + 2, values, (8, formula))
    main += "</x:sheetData></x:worksheet>"
    notes = xml_begin + row(2, ["册数", "来源文件", "总表PDF页码", "总表书内页码", "状态"]) + row(3, [1, "书1.pdf", "12", "10", "原表摘录"]) + "</x:sheetData></x:worksheet>"
    title = "第1册  |  册末生词表  |  PDF 12页 · 书内 10页  |  书1.pdf"
    pictures = xml_begin + row(10, [title]) + row(11, [title]) + '</x:sheetData><x:drawing r:id="draw"/></x:worksheet>'
    drawing = f'<d:wsDr xmlns:d="{importer.NS["d"]}" xmlns:a="{importer.NS["a"]}" xmlns:r="{importer.NS["r"]}"><d:oneCellAnchor><d:from><d:col>0</d:col><d:row>11</d:row></d:from><d:pic><d:blipFill><a:blip r:embed="picture"/></d:blipFill></d:pic></d:oneCellAnchor></d:wsDr>'

    def rels(items):
        return f'<Relationships xmlns="{importer.NS["p"]}">' + "".join(f'<Relationship Id="{rid}" Target="{target}" Type="{kind}"/>' for rid, target, kind in items) + "</Relationships>"

    with zipfile.ZipFile(path, "w") as z:
        z.writestr("xl/workbook.xml", f'<x:workbook xmlns:x="{importer.NS["x"]}" xmlns:r="{importer.NS["r"]}"><x:sheets><x:sheet name="词汇汇总" r:id="s1"/><x:sheet name="来源与使用" r:id="s2"/><x:sheet name="原表图像" r:id="s3"/></x:sheets></x:workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", rels([(f"s{i}", f"worksheets/sheet{i}.xml", "worksheet") for i in range(1, 4)]))
        z.writestr("xl/worksheets/sheet1.xml", main)
        z.writestr("xl/worksheets/sheet2.xml", notes)
        z.writestr("xl/worksheets/sheet3.xml", pictures)
        z.writestr("xl/worksheets/_rels/sheet3.xml.rels", rels([("draw", "../drawings/drawing1.xml", "drawing")]))
        z.writestr("xl/drawings/drawing1.xml", drawing)
        z.writestr("xl/drawings/_rels/drawing1.xml.rels", rels([("picture", "../media/source.png", "image")]))
        z.writestr("xl/media/source.png", buffer.getvalue())


class ParserTests(unittest.TestCase):
    def test_stress_does_not_destroy_diaeresis_or_breve(self):
        self.assertEqual(importer.normalize_search("е\u0308лка и и\u0306од, во\u0301да"), "ёлка и йод, вода")
        self.assertNotEqual(importer.normalize_search("й"), importer.normalize_search("и"))

    def test_multiple_lessons_and_unknown_syntax(self):
        self.assertEqual(importer.parse_lessons("3、9"), [3, 9])
        self.assertEqual(importer.parse_lessons("4, 7"), [4, 7])
        for invalid in ("", "1–7", "1,1", "0", "3x9"):
            with self.subTest(invalid=invalid), self.assertRaises(importer.ImportFailure):
                importer.parse_lessons(invalid)

    def test_formula_anchor_not_cached_display_value(self):
        self.assertEqual(importer.parse_hyperlink('IFERROR(HYPERLINK("#\'原表图像\'!$A$336","查看原表"),"查看原表")'), ("原表图像", "A336"))
        with self.assertRaises(importer.ImportFailure):
            importer.parse_hyperlink('HYPERLINK("https://example.test/","link")')
        with self.assertRaises(importer.ImportFailure):
            importer.parse_hyperlink("查看原表")

    def test_relationship_resolution_stays_in_zip(self):
        self.assertEqual(importer.resolve_part("xl/drawings/drawing1.xml", "../media/image.png"), "xl/media/image.png")
        with self.assertRaises(importer.ImportFailure):
            importer.resolve_part("xl/workbook.xml", "../../etc/passwd")


class ExtractionTests(unittest.TestCase):
    def test_shifted_header_and_idempotence_preserve_original_bytes_and_pairs(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            source = base / "input.xlsx"
            fixture(source, header_row=8)
            original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            a = importer.extract(source, base / "out", base / "assets", base / "reports")
            output_bytes = (base / "out/workbook.json").read_bytes()
            b = importer.extract(source, base / "out", base / "assets", base / "reports")
            self.assertEqual(a, b)
            self.assertEqual(output_bytes, (base / "out/workbook.json").read_bytes())
            self.assertEqual(original_hash, hashlib.sha256(source.read_bytes()).hexdigest())
            self.assertEqual(a["report"]["headerRow"], 8)
            self.assertEqual(len(a["entries"]), 1)
            self.assertEqual(a["entries"][0]["russian"], "ёлка / йод")
            self.assertEqual(a["entries"][0]["lessons"], [3, 9])
            self.assertEqual(a["entries"][0]["sourceKey"], "dongfang:b1:s1")
            self.assertEqual(a["report"]["associationCount"], 2)
            asset = a["assets"][0]
            self.assertEqual(asset["anchorRow"], 12)
            self.assertNotEqual(asset["fileName"], asset["thumbnailFileName"])
            self.assertEqual(hashlib.sha256((base / "assets" / asset["fileName"]).read_bytes()).hexdigest(), asset["sha256"])
            self.assertEqual(json.loads((base / "reports/version-diff.json").read_text())["status"], "unchanged")

    def test_bad_anchor_fails_and_keeps_previous_valid_output(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            source = base / "input.xlsx"
            fixture(source)
            importer.extract(source, base / "out", base / "assets", base / "reports")
            previous = (base / "out/workbook.json").read_bytes()
            fixture(source, target="A9")
            with self.assertRaises(importer.ImportFailure):
                importer.extract(source, base / "out", base / "assets", base / "reports")
            self.assertEqual(previous, (base / "out/workbook.json").read_bytes())
            self.assertEqual(len(json.loads((base / "reports/import-report.json").read_text())["unmappedRows"]), 1)

    def test_changed_identity_becomes_candidate_not_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            source = base / "input.xlsx"
            fixture(source)
            old = importer.extract(source, base / "out", base / "assets", base / "reports")
            fixture(source, russian="молоко")
            with self.assertRaisesRegex(importer.ImportFailure, "identity"):
                importer.extract(source, base / "out", base / "assets", base / "reports")
            self.assertEqual(json.loads((base / "out/workbook.json").read_text()), old)
            report = json.loads((base / "reports/version-diff.json").read_text())
            self.assertTrue(report["requiresIdentityReconciliation"])
            self.assertEqual(len(report["identityConflicts"]), 1)
            self.assertEqual(len(list((base / "out").glob("candidate-*.json"))), 1)

    def test_duplicate_source_identifiers_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            source = base / "input.xlsx"
            fixture(source, duplicate=True)
            with self.assertRaisesRegex(importer.ImportFailure, "Duplicate source mapping"):
                importer.extract(source, base / "out", base / "assets", base / "reports")


class ActualWorkbookAudit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = ROOT / "data/processed/workbook.json"
        if not path.exists():
            raise unittest.SkipTest("Run extraction first to audit the user's private workbook")
        cls.data = json.loads(path.read_text())

    def test_all_source_rows_and_associations(self):
        data = self.data
        self.assertEqual(data["workbook"]["sha256"], importer.EXPECTED["sha256"])
        self.assertEqual(data["report"]["providedBaselineDifferences"], [])
        self.assertEqual(len(data["entries"]), 4835)
        self.assertEqual(sum(len(e["lessons"]) for e in data["entries"]), 4838)
        self.assertEqual(len({(e["book"], n) for e in data["entries"] for n in e["lessons"]}), 69)
        self.assertEqual(len({e["sourceKey"] for e in data["entries"]}), 4835)
        self.assertEqual([x["sourceEntryCount"] for x in data["report"]["perBook"]], [718, 939, 1034, 871, 716, 557])

    def test_images_and_missing_meanings_not_silently_discarded(self):
        data = self.data
        self.assertEqual(len(data["assets"]), 108)
        self.assertEqual(len(data["report"]["unreferencedAssetIds"]), 4)
        self.assertEqual(data["report"]["unmappedRows"], [])
        self.assertTrue(all(len(e["assetIds"]) == 1 for e in data["entries"]))
        missing = [e for e in data["entries"] if e["missingMeaning"]]
        self.assertEqual(len(missing), 35)
        self.assertTrue(all(e["book"] == 5 and e["lessons"] == [7] for e in missing))
        self.assertEqual(len([e for e in data["report"]["issues"] if e["code"] == "aspect-dispute"]), 6)

    def test_document_identity_distinguishes_third_book_excerpt(self):
        third = [d for d in self.data["report"]["sourceDocuments"] if d["book"] == 3][0]
        self.assertTrue(third["isExcerpt"])
        self.assertEqual(third["pdfPageRange"], "1–17")
        self.assertEqual(third["printedPageRange"], "272–288")
        self.assertTrue(all(e["documentId"] == third["id"] for e in self.data["entries"] if e["book"] == 3))


if __name__ == "__main__":
    unittest.main()
