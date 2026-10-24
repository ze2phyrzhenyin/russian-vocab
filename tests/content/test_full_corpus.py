from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import build_annotations as builder
from annotation_expansion import CorpusAnnotator, FIELDS
import pymorphy3


class FullCorpusCandidateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.morph = pymorphy3.MorphAnalyzer(lang="ru")
        cls.annotator = CorpusAnnotator(cls.morph, builder.annotate, builder.SELECTION, builder.VERSION, builder.MORPH_SOURCE)

    def entry(self, russian, morphology="", chinese="合成测试释义"):
        return {"sourceKey": "fixture:row1", "rowNumber": 6, "serial": "1", "book": 1, "lessons": [1],
                "lessonRaw": "1", "russian": russian, "chinese": chinese, "morphology": morphology,
                "bookPage": "10", "pdfPage": "12", "originalLinkFormula": "fixture-anchor", "sourceLabel": "fixture",
                "notes": "", "searchOriginal": builder.normalize_search(russian), "rawColumns": {"俄语词条": russian, "中文释义": chinese},
                "documentId": "fixture-document", "assetIds": ["fixture-image"], "missingMeaning": not chinese, "disputed": False}

    def content(self, russian, morphology="", chinese="合成测试释义"):
        return self.annotator.annotate(self.entry(russian, morphology, chinese), [], "a" * 64)

    def test_unknown_dictionary_words_remain_unknown_without_invented_tables(self):
        fields, meta = self.content("абвгдежзийклмноп")
        self.assertEqual(set(fields), set(FIELDS))
        self.assertEqual(meta["category"], "unknown")
        for key in ("partOfSpeech", "lemma", "declension", "conjugation", "morphologyCandidates"):
            self.assertEqual(fields[key]["status"], "unknown")
            self.assertIsNone(fields[key]["value"])

    def test_true_pos_ambiguity_is_not_resolved_by_highest_dictionary_score(self):
        fields, meta = self.content("печь")
        self.assertEqual(meta["category"], "ambiguous")
        self.assertEqual(set(meta["partsOfSpeech"]), {"noun", "verb"})
        self.assertEqual(fields["declension"]["status"], "generated")
        self.assertEqual(fields["conjugation"]["status"], "generated")
        self.assertEqual(fields["aspectPairs"]["status"], "unknown")

    def test_explicit_source_pos_limits_candidates_and_mismatches_are_disputed(self):
        fields, meta = self.content("печь", "ж.")
        self.assertEqual(meta["category"], "noun")
        self.assertEqual(fields["partOfSpeech"]["status"], "source")
        self.assertEqual(fields["conjugation"]["status"], "not-applicable")
        conflict, _ = self.content("дом", "нареч.")
        self.assertEqual(conflict["partOfSpeech"]["status"], "disputed")
        self.assertEqual(conflict["declension"]["status"], "unknown")

    def test_source_nominalization_keeps_adjectival_inflection_without_false_conflict(self):
        fields, meta = self.content("больная", "[阴]；用作名词")
        self.assertEqual(meta["category"], "noun")
        self.assertEqual(fields["partOfSpeech"]["status"], "source")
        self.assertEqual(fields["declension"]["status"], "generated")
        self.assertEqual(fields["conjugation"]["status"], "not-applicable")
        unknown_verb, meta = self.content("абвгдежзийклмноп", "сов.")
        self.assertEqual(meta["category"], "verb")
        self.assertEqual(unknown_verb["partOfSpeech"]["status"], "source")
        self.assertEqual(unknown_verb["conjugation"]["status"], "unknown")

    def test_slash_preserves_one_item_and_does_not_create_an_aspect_pair(self):
        fields, meta = self.content("делать // сделать")
        self.assertEqual(meta["kind"], "word")
        self.assertEqual(fields["headword"]["value"], "делать // сделать")
        self.assertEqual(fields["aspectPairs"]["status"], "unknown")
        source, _ = self.content("делать // сделать", "несов.//сов.")
        self.assertEqual(source["aspectPairs"]["status"], "source")
        self.assertEqual(source["aspectPairs"]["value"]["raw"], "делать // сделать")
        self.assertNotIn("imperfective", source["aspectPairs"]["value"])

    def test_source_person_restrictions_are_honored_without_guessing_pair_scope(self):
        fields, _ = self.content("возглавляться", "第一、二人称不用")
        for table in fields["conjugation"]["value"]:
            self.assertTrue(all(row["forms"] is None for row in table["finite"] if row["person"] in {"1per", "2per"}))
        pair, _ = self.content("победить // побеждать", "单数第一人称不用")
        self.assertEqual(pair["conjugation"]["status"], "disputed")
        imperfective = next(table for table in pair["conjugation"]["value"] if table["lemma"] == "побеждать")
        first = next(row for row in imperfective["finite"] if row["person"] == "1per" and row["number"] == "sing")
        self.assertIn("побеждаю", first["forms"])

    def test_numeral_cases_do_not_claim_nonexistent_singular_plural_and_missing_meaning_stays_empty(self):
        fields, _ = self.content("два", "числ.")
        self.assertEqual(fields["declension"]["status"], "generated")
        table = fields["declension"]["value"][0]
        self.assertIn("cases", table)
        self.assertNotIn("rows", table)
        self.assertIn("двух", next(row for row in table["cases"] if row["case"] == "gent")["forms"])
        missing, _ = self.content("книга", chinese="")
        self.assertEqual(missing["meaning"]["status"], "unknown")
        self.assertIsNone(missing["meaning"]["value"])

    def test_complete_phrase_and_sentence_remain_whole_source_expressions(self):
        phrase, _ = self.content("читать книгу")
        self.assertEqual(phrase["declension"]["status"], "not-applicable")
        self.assertEqual(phrase["phraseUsage"]["status"], "unknown")
        self.assertEqual(phrase["examples"]["status"], "unknown")
        sentence, _ = self.content("Я читаю книгу.")
        self.assertEqual(sentence["examples"]["status"], "source")
        self.assertEqual(sentence["conjugation"]["status"], "not-applicable")
        self.assertEqual(sentence["sentenceAnalysis"]["status"], "unknown")

    def test_per_item_cache_validates_input_output_and_keeps_source_version_traceable(self):
        entry = self.entry("книга")
        workbook = {"workbook": {"sha256": "a" * 64}, "entries": [entry], "report": {"issues": []}}
        first, manifest, _, counts = builder.build_corpus(workbook, {}, {}, self.morph)
        self.assertEqual(counts, {"cacheHits": 0, "generatedItems": 1})
        second, second_manifest, _, counts = builder.build_corpus(workbook, first, manifest, self.morph)
        self.assertEqual(counts, {"cacheHits": 1, "generatedItems": 0})
        self.assertEqual(first, second)
        self.assertEqual(manifest, second_manifest)
        self.assertEqual(manifest["entries"][entry["sourceKey"]]["sourceRowFingerprint"], builder.fingerprint(entry))
        changed_file_only = copy.deepcopy(workbook)
        changed_file_only["workbook"]["sha256"] = "b" * 64
        _, cached_manifest, _, counts = builder.build_corpus(changed_file_only, first, manifest, self.morph)
        self.assertEqual(counts["cacheHits"], 1)
        self.assertEqual(cached_manifest["entries"][entry["sourceKey"]]["evidenceWorkbookSha256"], "a" * 64)
        modified = copy.deepcopy(workbook)
        modified["entries"][0]["chinese"] = "新测试释义"
        fresh, _, _, counts = builder.build_corpus(modified, first, manifest, self.morph)
        self.assertEqual(counts["generatedItems"], 1)
        self.assertEqual(fresh[entry["sourceKey"]]["meaning"]["value"], "新测试释义")
        corrupted = copy.deepcopy(first)
        corrupted[entry["sourceKey"]]["meaning"]["value"] = "缓存损坏"
        restored, _, _, counts = builder.build_corpus(workbook, corrupted, manifest, self.morph)
        self.assertEqual(counts["generatedItems"], 1)
        self.assertEqual(restored[entry["sourceKey"]]["meaning"]["value"], entry["chinese"])

    def test_canonical_fingerprint_preserves_unicode_identity(self):
        self.assertEqual(builder.canonical_bytes({"z": None, "a": ["ё", "й", "пообеща́ть"]}).decode(), '{"a":["ё","й","пообеща́ть"],"z":null}')
        self.assertNotEqual(builder.fingerprint({"a": "й"}), builder.fingerprint({"a": "и"}))
        fields, _ = self.content("книга")
        scores = [p["score"] for row in fields["morphologyCandidates"]["value"] for p in row["candidates"]]
        self.assertTrue(scores and all(isinstance(score, str) for score in scores))


if __name__ == "__main__":
    unittest.main()
