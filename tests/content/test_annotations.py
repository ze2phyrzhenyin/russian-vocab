from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import build_annotations as builder


class AnnotationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = ROOT / "data/processed/annotations.json"
        if not path.exists():
            raise unittest.SkipTest("Build the representative annotation artifact first")
        cls.annotations = json.loads(path.read_text())
        cls.entries = {e["sourceKey"]: e for e in json.loads((ROOT / "data/processed/workbook.json").read_text())["entries"]}

    def test_fifty_real_sources_and_distinct_categories(self):
        builder.validate(self.annotations, self.entries)
        self.assertEqual(len(self.annotations), 50)
        report = builder.report_coverage(self.annotations, self.entries)
        self.assertEqual({k: v["itemCount"] for k, v in report["perCategory"].items()}, {"noun": 15, "adjective": 10, "verb": 10, "phrase": 10, "sentence": 5})
        self.assertEqual(len(report["perLesson"]), 69)
        self.assertEqual(len(report["perBook"]), 6)
        self.assertEqual(report["notAnnotatedSourceCount"], 4785)
        for key, content in self.annotations.items():
            self.assertEqual(content["meaning"]["value"], self.entries[key]["chinese"])
            self.assertEqual(content["provenance"]["value"]["assetIds"], self.entries[key]["assetIds"])
            self.assertTrue(all(field["status"] != "reviewed" for field in content.values()))

    def test_perfective_personal_forms_are_future_not_present(self):
        promise = self.annotations["dongfang:b2:s1278"]["conjugation"]["value"][0]
        self.assertEqual(promise["tense"], "futr")
        self.assertEqual(promise["tenseLabel"], "简单将来时")
        first = next(row for row in promise["finite"] if row["number"] == "sing" and row["person"] == "1per")
        self.assertIn("пообещаю", first["forms"])
        for content in self.annotations.values():
            for table in content["conjugation"]["value"] or []:
                if table["aspect"] == "perf":
                    self.assertEqual(table["tense"], "futr")

    def test_indeclinable_forms_and_irregular_noun(self):
        for key, word in [("dongfang:b1:s299", "метро"), ("dongfang:b2:s1196", "пальто")]:
            table = self.annotations[key]["declension"]["value"][0]
            self.assertTrue(table["indeclinable"])
            self.assertEqual(len(table["rows"]), 6)
            self.assertTrue(all(row["singular"] == [word] for row in table["rows"]))
        mother = self.annotations["dongfang:b1:s291"]["declension"]["value"][0]
        genitive = next(row for row in mother["rows"] if row["case"] == "gent")
        self.assertIn("матери", genitive["singular"])
        self.assertIn("матерей", genitive["plural"])

    def test_six_disputes_not_laundered_into_verified_grammar(self):
        for serial in [3922, 3925, 3926, 3988, 3995, 4042]:
            item = self.annotations[f"dongfang:b5:s{serial}"]
            self.assertEqual(item["aspect"]["status"], "disputed")
            self.assertEqual(item["aspectPairs"]["status"], "disputed")
            self.assertEqual(item["conjugation"]["status"], "disputed")
            self.assertEqual(item["meaning"]["status"], "source")
            self.assertEqual(item["examples"]["status"], "unknown")

    def test_pair_mapping_only_uses_explicit_selected_source_labels(self):
        pair = self.annotations["dongfang:b3:s2498"]["aspectPairs"]
        self.assertEqual(pair["status"], "source")
        self.assertEqual(pair["value"]["imperfective"], "сообщать")
        self.assertEqual(pair["value"]["perfective"], "сообщить")
        self.assertEqual(self.annotations["dongfang:b2:s1278"]["aspectPairs"]["status"], "unknown")

    def test_sentences_not_given_single_inflection_table(self):
        for key, content in self.annotations.items():
            if content["entryType"]["value"] == "sentence":
                self.assertEqual(content["declension"]["status"], "not-applicable")
                self.assertEqual(content["conjugation"]["status"], "not-applicable")
                self.assertEqual(content["examples"]["status"], "source")
                self.assertEqual(content["examples"]["value"][0]["russian"], self.entries[key]["russian"])

    def test_generated_examples_and_missing_stress_are_honest(self):
        self.assertEqual(self.annotations["dongfang:b1:s3"]["examples"]["status"], "generated")
        self.assertEqual(self.annotations["dongfang:b1:s3"]["stress"]["status"], "unknown")
        self.assertEqual(self.annotations["dongfang:b2:s1278"]["stress"]["value"], "пообеща́ть")
        self.assertTrue(all(content["relatedWords"]["status"] == "unknown" for content in self.annotations.values()))

    def test_reviewed_input_cannot_be_overwritten_by_generator(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            annotations = json.loads(json.dumps(self.annotations))
            annotations["dongfang:b1:s3"]["meaning"]["status"] = "reviewed"
            output = base / "annotations.json"
            output.write_text(json.dumps(annotations, ensure_ascii=False))
            before = output.read_bytes()
            result = subprocess.run([sys.executable, str(ROOT / "scripts/build_annotations.py"), "--workbook", str(ROOT / "data/processed/workbook.json"), "--output", str(output), "--report", str(base / "report.json")], capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Reviewed content exists", result.stderr)
            self.assertEqual(output.read_bytes(), before)

    def test_reviewed_unselected_keys_and_removed_fields_cannot_be_dropped(self):
        for location in ("unselected-source-key", "removed-field"):
            with self.subTest(location=location), tempfile.TemporaryDirectory() as temp:
                base = Path(temp)
                annotations = json.loads(json.dumps(self.annotations))
                reviewed = {"value": "真实审核必须保留", "status": "reviewed", "source": "test-review-event"}
                if location == "unselected-source-key":
                    annotations["dongfang:b1:s4"] = {"meaning": reviewed}
                else:
                    annotations["dongfang:b1:s3"]["fieldAbsentFromGenerator"] = reviewed
                output = base / "annotations.json"
                output.write_text(json.dumps(annotations, ensure_ascii=False))
                before = output.read_bytes()
                report = base / "report.json"
                result = subprocess.run([sys.executable, str(ROOT / "scripts/build_annotations.py"), "--workbook", str(ROOT / "data/processed/workbook.json"), "--output", str(output), "--report", str(report)], capture_output=True, text=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Reviewed content exists", result.stderr)
                self.assertEqual(output.read_bytes(), before)
                self.assertFalse(report.exists())


if __name__ == "__main__":
    unittest.main()
