"""Conservative full-corpus candidates; no online model, review or sense merging."""
from __future__ import annotations

from collections import OrderedDict
import re

from extract_vocab import normalize_search

FIELDS = (
    "entryType", "headword", "meaning", "stress", "sourceMorphology", "partOfSpeech",
    "morphologyCandidates", "declension", "conjugation", "aspect", "aspectPairs",
    "government", "phraseUsage", "sentenceAnalysis", "examples", "relatedWords",
    "usageNotes", "provenance", "lemma", "pronunciation", "register", "gender",
    "animacy", "number", "conjugationType", "reflexive", "transitivity",
    "collocations", "commonErrors", "rootRelations", "synonyms", "antonyms",
)
POS = {
    "NOUN": ("noun", "名词"), "ADJF": ("adjective", "形容词"), "ADJS": ("adjective", "短尾形容词"),
    "COMP": ("adjective", "比较级"), "INFN": ("verb", "动词不定式"), "VERB": ("verb", "动词"),
    "PRTF": ("participle", "长尾形动词"), "PRTS": ("participle", "短尾形动词"),
    "GRND": ("gerund", "副动词"), "NUMR": ("numeral", "数词"), "NPRO": ("pronoun", "代词"),
    "ADVB": ("adverb", "副词"), "PRED": ("predicative", "述谓词"), "PREP": ("preposition", "介词"),
    "CONJ": ("conjunction", "连词"), "PRCL": ("particle", "语气词"), "INTJ": ("interjection", "感叹词"),
}
CASES = [("nomn", "主格"), ("gent", "属格"), ("datv", "与格"), ("accs", "宾格"), ("ablt", "工具格"), ("loct", "前置格")]
TOKEN = re.compile(r"[А-Яа-яЁё\u0300\u0301]+(?:[-‑][А-Яа-яЁё\u0300\u0301]+)*")
WORD = re.compile(r"[а-яё]+(?:[-‑][а-яё]+)*\Z")
DECLINABLE = {"NOUN", "ADJF", "NPRO", "PRTF", "NUMR"}
VERBAL = {"INFN", "VERB"}
ASPECTUAL = VERBAL | {"PRTF", "PRTS", "GRND"}


def explicit_pos(morphology):
    raw = normalize_search(morphology)
    hints = set()
    for pattern, tag in [
        (r"нареч\.", "ADVB"), (r"предл\.", "PREP"), (r"част\.", "PRCL"),
        (r"союз|连词", "CONJ"), (r"межд\.|感叹词", "INTJ"), (r"мест\.|代词", "NPRO"),
        (r"числ\.|数词", "NUMR"), (r"сущ\.|用作名词|\[阴\]|(?:^|[;,\s])(?:ж|м|ср)\.", "NOUN"),
        (r"прил\.|形容词", "ADJF"), (r"деепр\.|副动词", "GRND"),
    ]:
        if re.search(pattern, raw):
            hints.add(tag)
    if "形动词短尾" in raw:
        return {"PRTS"}
    if re.search(r"(?:^|\W)(?:несов|сов)\.", raw):
        hints.add("INFN")
    return hints


def compatible(pos, hint):
    return pos == hint or {pos, hint} <= VERBAL or {pos, hint} <= {"ADJF", "ADJS", "COMP"}


class CorpusAnnotator:
    def __init__(self, morph, legacy, representatives, version, dictionary_source):
        self.morph, self.legacy = morph, legacy
        self.representatives = {key: (category, components) for key, category, components in representatives}
        self.version, self.dictionary_source = version, dictionary_source
        self.parse_cache, self.lexeme_cache = {}, {}

    def field(self, value=None, status="unknown", source=None, method="No reliable evidence available"):
        result = {"value": value, "status": status, "method": method, "version": self.version}
        if source:
            result["source"] = source
        return result

    def dictionary(self, value, method="known-dictionary-candidates; no contextual sense disambiguation"):
        return self.field(value, "generated", self.dictionary_source, method)

    def parses(self, token):
        token = normalize_search(token)
        if token not in self.parse_cache:
            self.parse_cache[token] = [candidate for candidate in self.morph.parse(token) if candidate.is_known and candidate.tag.POS in POS]
        return self.parse_cache[token]

    def forms(self, candidate, required):
        key = (candidate.word, str(candidate.tag), candidate.normal_form)
        if key not in self.lexeme_cache:
            self.lexeme_cache[key] = [(form.word, frozenset(form.tag.grammemes)) for form in candidate.lexeme]
        return sorted({word for word, tags in self.lexeme_cache[key] if set(required) <= tags}) or None

    @staticmethod
    def summarize(candidate):
        return {"form": candidate.word, "lemma": candidate.normal_form, "tag": str(candidate.tag),
                "partOfSpeech": POS[candidate.tag.POS][1], "dictionaryKnown": True, "score": str(candidate.score)}

    def analyze(self, entry):
        raw = normalize_search(entry["russian"])
        representative = self.representatives.get(entry["sourceKey"])
        segments = [part.strip() for part in raw.split("//")]
        group = len(segments) > 1 and all(WORD.fullmatch(part) for part in segments)
        sentence = bool(re.search(r"[!?！？]$", raw) or (re.search(r"[.]$", raw) and not raw.endswith("...") and entry["russian"][0].isupper()))
        kind = "sentence" if sentence else "word" if WORD.fullmatch(raw) or group else "phrase"
        if representative:
            kind = representative[0] if representative[0] in {"phrase", "sentence"} else "word"
        tokens = TOKEN.findall(entry["russian"])
        hints = explicit_pos(entry["morphology"])
        candidates, chosen, all_parses = [], [], []
        nominalized = "用作名词" in entry["morphology"]
        for token in tokens:
            parses = self.parses(token)
            all_parses.extend(parses)
            candidates.append({"input": token, "candidates": [self.summarize(p) for p in parses[:6]],
                               "candidateCount": len(parses), "truncated": len(parses) > 6,
                               "note": "保留孤立词形歧义；不把匹配分数当成义项确认。"})
            chosen.extend(p for p in parses if not hints or any(compatible(p.tag.POS, hint) or (nominalized and hint == "NOUN" and p.tag.POS in {"ADJF", "ADJS"}) for hint in hints))
        if representative and representative[1]:
            wanted = {"noun": "NOUN", "adjective": "ADJF", "verb": "INFN"}[representative[0]]
            chosen = [next(p.normalized for p in self.parses(component) if p.tag.POS == wanted and p.normal_form == component) for component in representative[1]]
        unique = OrderedDict()
        for p in chosen:
            identity = (p.normal_form, p.tag.POS, p.tag.gender, p.tag.animacy, p.tag.aspect, p.tag.transitivity)
            unique.setdefault(identity, p)
        chosen = list(unique.values())
        parts = sorted({POS[p.tag.POS][0] for p in chosen})
        if kind in {"phrase", "sentence"}:
            parts, category = [kind], kind
        elif representative:
            parts, category = [representative[0]], representative[0]
        elif hints:
            parts = sorted({POS[hint][0] for hint in hints})
            if all_parses and not chosen:
                parts = sorted(set(parts) | {POS[p.tag.POS][0] for p in all_parses})
            category = parts[0] if len(parts) == 1 else "ambiguous"
        else:
            category = parts[0] if len(parts) == 1 else "ambiguous" if parts else "unknown"
            parts = parts or ["unknown"]
        known_count = sum(row["candidateCount"] for row in candidates)
        return {"kind": kind, "category": category, "partsOfSpeech": parts, "candidates": candidates,
                "chosen": chosen, "hints": hints, "knownCount": known_count,
                "sourcePosConflict": bool(hints and known_count and not chosen), "group": group}

    def declension(self, p):
        pos = p.tag.POS
        common = {"lemma": p.normal_form, "category": POS[pos][0], "gender": p.tag.gender, "animacy": p.tag.animacy,
                  "indeclinable": "Fixd" in p.tag, "singularOnly": "Sgtm" in p.tag, "pluralOnly": "Pltm" in p.tag,
                  "note": "词典候选，未按教材义项消歧；null 表示未找到符合全部标签的词形。"}
        if pos == "NUMR":
            return {**common, "cases": [{"case": code, "label": label, "forms": self.forms(p, {pos, code})} for code, label in CASES]}
        rows = []
        for code, label in CASES:
            if pos in {"ADJF", "PRTF"}:
                row = {gender: self.forms(p, {pos, code, "sing", gender}) for gender in ("masc", "femn", "neut")}
            else:
                row = {"singular": self.forms(p, {pos, code, "sing"})}
            rows.append({"case": code, "label": label, **row, "plural": self.forms(p, {pos, code, "plur"})})
        return {**common, "rows": rows}

    def conjugation(self, p, entry):
        p = p.normalized
        tense = "futr" if p.tag.aspect == "perf" else "pres" if p.tag.aspect == "impf" else None
        finite = []
        for number in ("sing", "plur"):
            for person in ("1per", "2per", "3per"):
                # A row containing alternatives does not identify which member
                # the restriction modifies. Preserve that uncertainty below.
                excluded = "//" not in entry["russian"] and (("第一、二人称不用" in entry["morphology"] and person in {"1per", "2per"}) or ("单数第一人称不用" in entry["morphology"] and number == "sing" and person == "1per"))
                finite.append({"number": number, "person": person, "forms": None if excluded or not tense else self.forms(p, {"VERB", tense, number, person}),
                               **({"note": "原表明确标注此人称不用，不展示字典自动候选。"} if excluded else {})})
        return {"lemma": p.normal_form, "aspect": p.tag.aspect, "tense": tense,
                "tenseLabel": "简单将来时" if tense == "futr" else "现在时" if tense == "pres" else "体未知",
                "finite": finite, "past": {g: self.forms(p, {"VERB", "past", "sing", g}) for g in ("masc", "femn", "neut")},
                "pastPlural": self.forms(p, {"VERB", "past", "plur"}),
                "imperative": {n: self.forms(p, {"VERB", "impr", n, "excl"}) for n in ("sing", "plur")},
                "transitivity": p.tag.transitivity, "reflexive": p.normal_form.endswith(("ся", "сь")), "conjugationClass": None,
                "note": "自动词典候选；传统变位类型、重音及语境适用性尚待核查。", "sourceNote": entry["morphology"]}

    def annotate(self, entry, issues, corpus_sha):
        analysis = self.analyze(entry)
        source = f"workbook:{corpus_sha}#词汇汇总!D{entry['rowNumber']}:L{entry['rowNumber']}; {entry['documentId']}; 书内{entry['bookPage']} / PDF{entry['pdfPage']}"
        source_field = lambda value, method="verbatim-workbook-cell": self.field(value, "source", source, method)
        absent = lambda: self.field(None, "not-applicable", method="Not applicable to this entry type or known dictionary parts of speech")
        content = {name: self.field() for name in FIELDS}
        kind, choices = analysis["kind"], analysis["chosen"]
        content.update({"entryType": self.field(kind, "generated", source, "conservative-source-structure-classification"),
                        "headword": source_field(entry["russian"]), "meaning": source_field(entry["chinese"]),
                        "provenance": source_field({k: entry[k] for k in ("sourceKey", "rowNumber", "book", "lessons", "documentId", "assetIds", "bookPage", "pdfPage", "originalLinkFormula")}, "immutable-source-mapping")})
        if entry["missingMeaning"]:
            content["meaning"] = self.field(None, "unknown", source, "Workbook explicitly lacks Chinese meaning; placeholder is not a translation")
        if "\u0301" in entry["russian"] or "\u0300" in entry["russian"]:
            content["stress"] = source_field(entry["russian"], "retain-explicit-source-stress-only")
        for name, value in (("sourceMorphology", entry["morphology"]), ("usageNotes", entry["notes"])):
            if value:
                content[name] = source_field(value)
        if analysis["knownCount"]:
            content["morphologyCandidates"] = self.dictionary(analysis["candidates"])
        if kind != "word":
            content["partOfSpeech"] = self.field(["词组" if kind == "phrase" else "句子／交际表达"], "generated", source, "whole-expression classification; token candidates remain separate")
            for name in ("lemma", "declension", "conjugation", "aspect", "aspectPairs", "gender", "animacy", "number", "conjugationType", "reflexive", "transitivity"):
                content[name] = absent()
        else:
            if choices:
                content["partOfSpeech"] = self.dictionary(list(dict.fromkeys(POS[p.tag.POS][1] for p in choices)))
                content["lemma"] = self.dictionary(list(dict.fromkeys(p.normal_form for p in choices)))
            if analysis["hints"]:
                content["partOfSpeech"] = source_field([POS[tag][1] for tag in sorted(analysis["hints"])], "explicit-workbook-pos-markers; do not infer from Chinese gloss")
            if analysis["sourcePosConflict"]:
                content["partOfSpeech"] = self.field({"sourceClaim": content["partOfSpeech"]["value"], "raw": entry["morphology"], "candidates": analysis["candidates"], "note": "词典的孤立词形标签与原表语境标注不同，不能据此判定原表错误。"}, "disputed", source + "; " + self.dictionary_source, "source-marker and known dictionary POS mismatch; not proof of a textbook error")
            nominal = [p for p in choices if p.tag.POS in DECLINABLE]
            verbs = [p for p in choices if p.tag.POS in VERBAL]
            aspectual = [p for p in choices if p.tag.POS in ASPECTUAL]
            for name, selected, value in (
                ("declension", nominal, lambda: [self.declension(p) for p in nominal]),
                ("conjugation", verbs, lambda: [self.conjugation(p, entry) for p in verbs]),
                ("aspect", aspectual, lambda: [{"lemma": p.normal_form, "value": p.tag.aspect, "label": "完成体" if p.tag.aspect == "perf" else "未完成体" if p.tag.aspect == "impf" else "未确定"} for p in aspectual]),
                ("gender", nominal, lambda: [{"form": p.word, "lemma": p.normal_form, "value": p.tag.gender} for p in nominal if p.tag.gender]),
                ("animacy", nominal, lambda: [{"form": p.word, "lemma": p.normal_form, "value": p.tag.animacy} for p in nominal if p.tag.animacy]),
                ("number", nominal, lambda: [{"form": p.word, "lemma": p.normal_form, "singularOnly": "Sgtm" in p.tag, "pluralOnly": "Pltm" in p.tag, "indeclinable": "Fixd" in p.tag} for p in nominal]),
                ("reflexive", aspectual, lambda: [{"lemma": p.normal_form, "value": p.normal_form.endswith(("ся", "сь"))} for p in aspectual]),
                ("transitivity", aspectual, lambda: [{"lemma": p.normal_form, "value": p.tag.transitivity} for p in aspectual if p.tag.transitivity]),
            ):
                values = value() if selected else None
                if values:
                    content[name] = self.dictionary(values)
                elif choices and not selected:
                    content[name] = absent()
            if choices and not verbs:
                content["conjugationType"] = absent()
                content["aspectPairs"] = absent()
        content["phraseUsage"] = self.field() if kind == "phrase" else absent()
        content["sentenceAnalysis"] = self.field() if kind == "sentence" else absent()
        if kind == "sentence" and not entry["missingMeaning"]:
            content["examples"] = source_field([{"russian": entry["russian"], "chinese": entry["chinese"], "origin": "原表本条目作为交际表达收录；不是额外生成例句"}])
        if kind == "phrase":
            content["collocations"] = source_field({"raw": entry["russian"], "scope": "教材按整组表达收录；固定性和具体用法仍待核查。"})
        normalized_morph = normalize_search(entry["morphology"])
        if re.search(r"\b(?:кого|чего|кому|чему|кем|чем|ком|чём|что)\b|с инф\.", normalized_morph):
            content["government"] = source_field({"raw": entry["morphology"], "scope": "保留原表支配文字；具体格解释、语境和例句尚待核查。"})
        if re.search(r"разг|прост|книж|устар|стар\.|бран|шутл|перен|口语|书面|旧|俚", normalized_morph):
            content["register"] = source_field({"raw": entry["morphology"], "scope": "仅保留原表语体或转义标注，不扩大到全部义项。"})
        if analysis["group"] and re.search(r"несов\.\s*//\s*сов\.", normalized_morph):
            content["aspectPairs"] = source_field({"raw": entry["russian"], "sourceAspect": entry["morphology"], "scope": entry["chinese"], "note": "仅记录原表并列及体标注；不凭斜线顺序或前缀新增对应关系。"})
        if entry["sourceKey"] in self.representatives:
            category, components = self.representatives[entry["sourceKey"]]
            content.update(self.legacy(entry, category, components, self.morph, issues, corpus_sha))
        if analysis["group"] and "人称不用" in entry["morphology"] and content["conjugation"]["value"]:
            content["conjugation"]["status"] = "disputed"
            content["conjugation"]["source"] = source + "; " + self.dictionary_source
            content["conjugation"]["method"] = "Source person restriction has unresolved scope across co-listed members; retain dictionary candidates without declaring either usage verified"
        for issue in issues:
            if issue["code"] == "aspect-dispute":
                for name in ("aspect", "aspectPairs", "conjugation"):
                    if content[name]["status"] != "disputed":
                        content[name] = self.field({"sourceClaim": entry["morphology"], "dictionaryCandidates": content[name]["value"], "warning": entry["notes"]}, "disputed", source + "; " + self.dictionary_source, "retain known source dispute; no automatic correction")
            elif issue["code"] != "missing-meaning":
                for affected, name in (("russian", "headword"), ("chinese", "meaning")):
                    if affected in issue["affectedFields"] and content[name]["value"] is not None:
                        content[name]["status"] = "disputed"
            if issue["code"] != "missing-meaning":
                content["commonErrors"] = self.field({"raw": entry["notes"], "scope": issue["affectedFields"]}, "disputed", source, "known-source-issue; not an invented learner mistake")
        return {name: content[name] for name in FIELDS}, analysis
