#!/usr/bin/env python3
"""Build source-traceable annotations for every source row, with per-item caching.

This is a deterministic local candidate generator, not a human review or AI API.
No textbook translation is overwritten and no homonyms are merged.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import importlib.metadata
import hashlib
import json
from pathlib import Path
import re

from extract_vocab import json_bytes, normalize_search, write_if_different
from annotation_expansion import CorpusAnnotator, FIELDS as REQUIRED_FIELDS, POS

VERSION = "full-corpus-annotations-v2"
MORPH_SOURCE = "OpenCorpora / pymorphy3-dicts-ru 2.4.417150.4580142; https://pypi.org/project/pymorphy3-dicts-ru/; CC BY-SA 3.0"
GRAMMAR_SOURCE = "https://pymorphy2.readthedocs.io/en/stable/user/grammemes.html"
STATUS_VALUES = {"source", "generated", "reviewed", "unknown", "disputed", "not-applicable"}
CASES = [("nomn", "主格"), ("gent", "属格"), ("datv", "与格"), ("accs", "宾格"), ("ablt", "工具格"), ("loct", "前置格")]
POS_LABELS = {"NOUN": "名词", "ADJF": "形容词", "ADJS": "短尾形容词", "INFN": "动词不定式", "VERB": "动词", "NPRO": "代词", "PREP": "介词", "ADVB": "副词", "PRCL": "语气词", "CONJ": "连词", "INTJ": "感叹词"}

# Each selection is explicit: source pairs are never mechanically split.
SELECTION = [
    *[(f"dongfang:b1:s{serial}", "noun", [word]) for serial, word in [(3,"автобус"),(18,"банк"),(21,"библиотека"),(26,"брат"),(53,"вода"),(95,"город"),(146,"дом"),(156,"друг"),(241,"книга"),(291,"мать"),(368,"окно"),(402,"письмо"),(582,"студент"),(299,"метро")]],
    ("dongfang:b2:s1196", "noun", ["пальто"]),
    *[(f"dongfang:b1:s{serial}", "adjective", [word]) for serial, word in [(5,"английский"),(24,"большой"),(38,"великий"),(40,"весёлый"),(141,"добрый"),(343,"новый"),(502,"русский"),(669,"хороший"),(213,"интересный")]],
    ("dongfang:b2:s1601", "adjective", ["холодный"]),
    *[(f"dongfang:b5:s{serial}", "verb", [word]) for serial, word in [(3922,"отбить"),(3925,"отделаться"),(3926,"откликнуться"),(3988,"попереть"),(3995,"постелить"),(4042,"прописать")]],
    ("dongfang:b3:s2449", "verb", ["сдаваться", "сдаться"]),
    ("dongfang:b3:s2498", "verb", ["сообщать", "сообщить"]),
    ("dongfang:b2:s1278", "verb", ["пообещать"]),
    ("dongfang:b1:s649", "verb", ["учиться"]),
    *[(f"dongfang:b3:s{serial}", "phrase", []) for serial in [1720,1721,1722,1724]],
    *[(f"dongfang:b1:s{serial}", "phrase", []) for serial in [563,197,198,625]],
    *[(f"dongfang:b2:s{serial}", "phrase", []) for serial in [894,972]],
    *[(f"dongfang:b1:s{serial}", "sentence", []) for serial in [139,140,263]],
    *[(f"dongfang:b2:s{serial}", "sentence", []) for serial in [1082,1107]],
]

# Authored teaching drafts, deliberately kept separate from textbook evidence.
EXAMPLES = {
    "автобус": ("Этот автобус идёт в центр.", "这辆公共汽车开往市中心。"),
    "банк": ("Банк рядом с домом.", "银行在家旁边。"),
    "библиотека": ("Я читаю в библиотеке.", "我在图书馆看书。"),
    "брат": ("Это мой брат.", "这是我的兄弟。"),
    "вода": ("В стакане вода.", "杯子里有水。"),
    "город": ("Это большой город.", "这是一座大城市。"),
    "дом": ("Наш дом недалеко от школы.", "我们家离学校不远。"),
    "друг": ("Мой друг учится в Москве.", "我的朋友在莫斯科学习。"),
    "книга": ("Эта книга очень интересная.", "这本书很有趣。"),
    "мать": ("Моя мать работает в школе.", "我的母亲在学校工作。"),
    "окно": ("Окно открыто.", "窗户开着。"),
    "письмо": ("Я пишу письмо другу.", "我给朋友写信。"),
    "студент": ("Он студент университета.", "他是大学生。"),
    "метро": ("Я еду на метро.", "我坐地铁。"),
    "пальто": ("На нём новое пальто.", "他穿着一件新大衣。"),
    "английский": ("Я изучаю английский язык.", "我在学英语。"),
    "большой": ("Это большая комната.", "这是一个大房间。"),
    "великий": ("Пушкин — великий поэт.", "普希金是一位伟大的诗人。"),
    "весёлый": ("У неё весёлый характер.", "她性格开朗。"),
    "добрый": ("Он добрый человек.", "他是个善良的人。"),
    "новый": ("У меня новый словарь.", "我有一本新词典。"),
    "русский": ("Я читаю русскую книгу.", "我在读一本俄语书。"),
    "хороший": ("Сегодня хорошая погода.", "今天天气很好。"),
    "интересный": ("Это интересный фильм.", "这是一部有趣的电影。"),
    "холодный": ("На столе холодный чай.", "桌上有凉茶。"),
    "сдаваться//сдаться": ("Он не хочет сдаваться.", "他不想认输。"),
    "сообщать//сообщить": ("Я сообщу вам результат завтра.", "我明天把结果告诉您。"),
    "пообещать": ("Он пообещал помочь.", "他答应帮忙。"),
    "учиться": ("Я учусь в университете.", "我在大学学习。"),
    "в канун": ("Мы встретились в канун праздника.", "我们在节日前夕见了面。"),
    "в качестве": ("Он приехал в качестве переводчика.", "他以翻译的身份来了。"),
    "в кругу": ("Мы провели вечер в кругу друзей.", "我们和朋友们一起度过了晚上。"),
    "в первую очередь": ("В первую очередь нужно отдохнуть.", "首先需要休息。"),
    "спортивный зал": ("Спортивный зал находится на первом этаже.", "体育馆在一楼。"),
    "играть в футбол": ("Мы любим играть в футбол.", "我们喜欢踢足球。"),
    "играть на гитаре": ("Она умеет играть на гитаре.", "她会弹吉他。"),
    "у окна": ("Я сижу у окна.", "我坐在窗边。"),
    "друг друга": ("Мы хорошо понимаем друг друга.", "我们很理解彼此。"),
    "к сожалению": ("К сожалению, я не могу прийти.", "很遗憾，我不能来。"),
}

USAGE_DRAFTS = {
    "в канун": "教材标注 чего：后接属格。例句中的 праздника 是 праздник 的单数属格候选，表示在节日前夕。",
    "в качестве": "教材标注 кого-чего：后接属格，表示以某种身份或资格。переводчика 是 переводчик 的单数属格候选。",
    "в кругу": "教材标注 кого：这里表示处于某群体之中。例句中 друзей 是 друг 的复数属格候选。",
    "в первую очередь": "固定表达表示优先顺序。不要按每个词的孤立中文义项逐字拼接。",
    "спортивный зал": "形容词与名词构成搭配，通常随名词一起变格。教材另列缩写 спортзал，不能据此认定二者是同根词关系。",
    "играть в футбол": "运动项目搭配使用 играть в。当前短语中 футбол 的宾格形式与主格相同；词形相同不代表可以忽略结构。",
    "играть на гитаре": "乐器搭配使用 играть на。当前短语中 гитаре 按该搭配解释为前置格；单看字形也有与格候选，须结合语境。",
    "у окна": "у 后接属格。окна 在此处是 окно 的单数属格候选；不能仅凭 -а 把它判成复数主格。",
    "друг друга": "互指结构需按句子位置理解。不要把原短语拆成两个独立单词后分别判题。",
    "к сожалению": "固定插入语，表示遗憾。сожалению 的形式与介词 к 所需的与格一致。",
    "До свидания!": "告别表达；这里作为完整交际用语学习，不给整句套一张变格表。",
    "Доброе утро!": "早晨问候语；доброе 与中性名词 утро 一致。用于问候的整体表达与单独的单词练习分开。",
    "Кто он такой?": "询问某人是什么人或身份；保留完整疑问句作为学习项目。",
    "На что вы жалуетесь?": "医疗问诊中询问不适。жалуетесь 是 жаловаться 的第二人称复数候选，也用于尊称 Вы。",
    "Не падайте духом!": "劝慰用语。падайте 是命令式复数候选；本句不能按字面翻译成身体下落。",
}


def field(value, status, source=None, method=None, version=VERSION):
    return {"value": value, "status": status, **({"source": source} if source else {}), **({"method": method} if method else {}), "version": version}


def summarize_parse(parse):
    return {"form": parse.word, "lemma": parse.normal_form, "tag": str(parse.tag), "partOfSpeech": POS_LABELS.get(parse.tag.POS, parse.tag.POS), "dictionaryKnown": parse.is_known, "score": str(parse.score)}


def dictionary_forms(parse, required):
    # Enumerate true lexeme forms with exact requested tags. Do not accept a
    # convenient fallback from inflect() when the requested form is absent.
    return sorted({form.word for form in parse.lexeme if required <= set(form.tag.grammemes)})


def declension(parse, category):
    rows = []
    for code, label in CASES:
        if category == "noun":
            rows.append({"case": code, "label": label, "singular": dictionary_forms(parse, {"NOUN", code, "sing"}) or None, "plural": dictionary_forms(parse, {"NOUN", code, "plur"}) or None})
        else:
            rows.append({"case": code, "label": label, **{gender: dictionary_forms(parse, {"ADJF", code, "sing", gender}) or None for gender in ("masc", "femn", "neut")}, "plural": dictionary_forms(parse, {"ADJF", code, "plur"}) or None})
    return {"lemma": parse.normal_form, "category": category, "gender": parse.tag.gender, "animacy": parse.tag.animacy, "indeclinable": "Fixd" in parse.tag, "singularOnly": "Sgtm" in parse.tag, "pluralOnly": "Pltm" in parse.tag, "rows": rows, "note": "自动形态候选；null 表示当前词典中未找到符合全部标签的形式。宾格可能随生命性出现多种形式。"}


def conjugation(parse):
    tense = "futr" if parse.tag.aspect == "perf" else "pres" if parse.tag.aspect == "impf" else None
    finite = []
    if tense:
        for number in ("sing", "plur"):
            for person in ("1per", "2per", "3per"):
                finite.append({"number": number, "person": person, "forms": dictionary_forms(parse, {"VERB", tense, number, person}) or None})
    return {"lemma": parse.normal_form, "aspect": parse.tag.aspect, "tense": tense, "tenseLabel": "简单将来时" if tense == "futr" else "现在时" if tense == "pres" else "体未确定，未归类人称形式", "finite": finite, "past": {gender: dictionary_forms(parse, {"VERB", "past", "sing", gender}) or None for gender in ("masc", "femn", "neut")}, "pastPlural": dictionary_forms(parse, {"VERB", "past", "plur"}) or None, "imperative": {number: dictionary_forms(parse, {"VERB", "impr", number, "excl"}) or None for number in ("sing", "plur")}, "transitivity": parse.tag.transitivity, "reflexive": parse.normal_form.endswith(("ся", "сь")), "conjugationClass": None, "note": "当前词典不提供可信的重音和传统变位分类；这些栏目仍需核查。"}


def annotate(entry, category, components, morph, issues, corpus_sha):
    source = f"workbook:{corpus_sha}#词汇汇总!D{entry['rowNumber']}:L{entry['rowNumber']}; {entry['documentId']}; 书内{entry['bookPage']} / PDF{entry['pdfPage']}"
    morph_version = f"pymorphy3 {importlib.metadata.version('pymorphy3')}; dict {importlib.metadata.version('pymorphy3-dicts-ru')}"
    dictionary_field = lambda value: field(value, "generated", MORPH_SOURCE, "dictionary-parse-and-exact-lexeme-enumeration", morph_version)
    kind = category if category in {"phrase", "sentence"} else "word"
    raw_search = normalize_search(entry["russian"])
    content = {
        "entryType": field(kind, "generated", source, "explicit-50-item-editorial-selection"),
        "headword": field(entry["russian"], "source", source, "verbatim-workbook-cell"),
        "meaning": field(entry["chinese"], "disputed" if any("chinese" in issue["affectedFields"] for issue in issues) else "source", source, "verbatim-workbook-cell"),
        "stress": field(entry["russian"] if "\u0301" in entry["russian"] else None, "source" if "\u0301" in entry["russian"] else "unknown", source, "retain-explicit-source-stress-only"),
        "sourceMorphology": field(entry["morphology"] or None, "source" if entry["morphology"] else "unknown", source, "verbatim-workbook-cell"),
        "aspectPairs": field(None, "not-applicable" if category != "verb" else "unknown"),
        "government": field(None, "unknown"),
        "relatedWords": field(None, "unknown", method="No etymology/synonym relation inferred from spelling or prefixes"),
        "examples": field(None, "unknown"),
        "usageNotes": field(entry["notes"] or None, "source" if entry["notes"] else "unknown", source, "verbatim-workbook-note"),
        "provenance": field({"sourceKey": entry["sourceKey"], "rowNumber": entry["rowNumber"], "book": entry["book"], "lessons": entry["lessons"], "documentId": entry["documentId"], "assetIds": entry["assetIds"], "bookPage": entry["bookPage"], "pdfPage": entry["pdfPage"], "originalLinkFormula": entry["originalLinkFormula"]}, "source", source, "immutable-source-mapping"),
    }
    if category in {"phrase", "sentence"}:
        token_rows = []
        for token in re.findall(r"[А-Яа-яЁё]+", entry["russian"]):
            known = [p for p in morph.parse(normalize_search(token)) if p.is_known]
            token_rows.append({"token": token, "candidates": [summarize_parse(p) for p in known[:4]], "note": "孤立词形候选，未自动消歧"})
        content["morphologyCandidates"] = dictionary_field(token_rows)
        content["partOfSpeech"] = field("短语" if category == "phrase" else "句子／交际表达", "generated", source, "explicit-selection")
        content["declension"] = field(None, "not-applicable", method="Do not create one inflection table for an entire phrase/sentence")
        content["conjugation"] = field(None, "not-applicable")
        content["aspect"] = field(None, "not-applicable")
        content["phraseUsage" if category == "phrase" else "sentenceAnalysis"] = field(USAGE_DRAFTS.get(entry["russian"], "保留整体表达，分词候选只供核对。"), "generated", source + "; " + GRAMMAR_SOURCE, "Codex-authored-teaching-draft; not human reviewed")
    else:
        wanted = {"noun": {"NOUN"}, "adjective": {"ADJF"}, "verb": {"INFN"}}[category]
        choices = []
        all_candidates = []
        for component in components:
            parses = [p for p in morph.parse(component) if p.is_known]
            all_candidates.append({"input": component, "candidates": [summarize_parse(p) for p in parses[:6]]})
            selected = next((p.normalized for p in parses if p.tag.POS in wanted and p.normal_form == component), None)
            if selected is None:
                raise ValueError(f"Selected representative component has no expected known dictionary lemma: {component}")
            choices.append(selected)
        content["morphologyCandidates"] = dictionary_field(all_candidates)
        content["partOfSpeech"] = dictionary_field(list(dict.fromkeys(POS_LABELS[p.tag.POS] for p in choices)))
        content["declension"] = dictionary_field([declension(p, category) for p in choices]) if category in {"noun", "adjective"} else field(None, "not-applicable")
        content["conjugation"] = dictionary_field([conjugation(p) for p in choices]) if category == "verb" else field(None, "not-applicable")
        content["aspect"] = dictionary_field([{ "lemma": p.normal_form, "value": p.tag.aspect, "label": "完成体" if p.tag.aspect == "perf" else "未完成体" if p.tag.aspect == "impf" else "未确定"} for p in choices]) if category == "verb" else field(None, "not-applicable")
        if category == "verb" and len(components) == 2 and entry["morphology"] == "несов. // сов.":
            content["aspectPairs"] = field({"imperfective": components[0], "perfective": components[1], "sense": entry["chinese"], "scope": "仅当前源词条所列义项；未扩展为通用同义或同根关系"}, "source", source, "explicit-pair-selection-plus-source-aspect-labels")
    if entry["sourceKey"] in {"dongfang:b3:s1720", "dongfang:b3:s1721", "dongfang:b3:s1722", "dongfang:b2:s1278"}:
        content["government"] = field({"raw": entry["morphology"], "note": "按教材原标注保留；具体句中的格和意义须结合语境。"}, "source", source, "verbatim-government-markers")
    if any(issue["code"] == "aspect-dispute" for issue in issues):
        content["aspect"] = field({"sourceClaim": entry["morphology"], "dictionaryCandidates": content["aspect"]["value"], "warning": entry["notes"]}, "disputed", source + "; " + MORPH_SOURCE, "retain-source-dictionary-conflict; no automatic correction", morph_version)
        content["aspectPairs"] = field({"raw": entry["morphology"], "warning": entry["notes"]}, "disputed", source, "unresolved-source-pair")
        # Even mechanically generated conjugations are explicitly not a resolution
        # of the disputed textbook aspect or sense pairing.
        content["conjugation"]["status"] = "disputed"
    if kind == "sentence":
        content["examples"] = field([{ "russian": entry["russian"], "chinese": entry["chinese"], "origin": "本条目本身是原书句子／交际用语"}], "source", source, "source-sentence-as-example")
    elif raw_search in EXAMPLES:
        russian, chinese = EXAMPLES[raw_search]
        content["examples"] = field([{ "russian": russian, "chinese": chinese, "origin": "教学示例草稿，非教材摘句"}], "generated", "project:scripts/build_annotations.py#EXAMPLES", "Codex-authored-teaching-draft; not human reviewed")
    return content


def validate(annotations, entries):
    if set(annotations) != set(entries):
        raise ValueError("Every source row must have exactly one annotation object; no omitted or invented source keys")
    for key, fields in annotations.items():
        if key not in entries:
            raise ValueError(f"Annotation source key not in workbook: {key}")
        if set(fields) != set(REQUIRED_FIELDS):
            raise ValueError(f"Annotation fields do not match the complete field contract: {key}")
        for name, value in fields.items():
            if value.get("status") not in STATUS_VALUES or "value" not in value:
                raise ValueError(f"Invalid EvidenceField {key}.{name}")
            if value["status"] == "reviewed":
                raise ValueError("Generated annotation artifacts must not manufacture human review status")
            if value["status"] in {"source", "generated", "disputed"} and not value.get("source"):
                raise ValueError(f"Missing traceable source for {key}.{name}")
            if value["status"] in {"unknown", "not-applicable"} and value["value"] is not None:
                raise ValueError(f"Unknown/inapplicable field must have null value: {key}.{name}")


def reject_reviewed_input(previous):
    # The generator replaces the artifact, so protection must include keys and
    # fields outside the current selection, not only those being regenerated.
    for key, fields in previous.items():
        for name, value in fields.items():
            if value.get("status") == "reviewed":
                raise ValueError(f"Reviewed content exists in source artifact ({key}.{name}): use review-aware database revision pipeline, do not overwrite")


def canonical_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def fingerprint(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def dictionary_identity(morph):
    return {"pymorphy3": importlib.metadata.version("pymorphy3"),
            "pymorphy3DictsRu": importlib.metadata.version("pymorphy3-dicts-ru"),
            "source": morph.dictionary.meta["source"], "sourceVersion": morph.dictionary.meta["source_version"],
            "sourceRevision": morph.dictionary.meta["source_revision"], "corpusRevision": morph.dictionary.meta["corpus_revision"],
            "license": "CC BY-SA 3.0"}


def generator_code_hash():
    directory = Path(__file__).parent
    return fingerprint({name: hashlib.sha256((directory / name).read_bytes()).hexdigest()
                        for name in ("build_annotations.py", "annotation_expansion.py", "extract_vocab.py")})


def classify_fields(fields):
    kind = fields["entryType"]["value"]
    if kind in {"phrase", "sentence"}:
        return kind, [kind]
    inverse = {label: category for category, label in POS.values()}
    value = fields["partOfSpeech"]["value"]
    labels = value if isinstance(value, list) else []
    categories = sorted({inverse[label] for label in labels if isinstance(label, str) and label in inverse}) or ["unknown"]
    return categories[0] if len(categories) == 1 else "ambiguous", categories


def report_coverage(annotations, entries, metadata=None):
    fields = list(REQUIRED_FIELDS)
    def summarize(keys):
        result = {}
        keys = list(keys)
        for name in fields:
            statuses = Counter(annotations[key][name]["status"] for key in keys)
            applicable = len(keys) - statuses["not-applicable"]
            result[name] = {"itemCount": len(keys), "applicableCount": applicable, "statusCounts": dict(statuses),
                            "sourceRate": statuses["source"] / applicable if applicable else None,
                            "generatedCandidateRate": statuses["generated"] / applicable if applicable else None,
                            "unknownRate": statuses["unknown"] / applicable if applicable else None,
                            "humanReviewedRate": statuses["reviewed"] / applicable if applicable else None}
        return result
    by_book, by_lesson, by_category, by_pos = defaultdict(list), defaultdict(list), defaultdict(list), defaultdict(list)
    source_per_book = Counter(str(entry["book"]) for entry in entries.values())
    source_per_lesson = Counter(f"{entry['book']}-{lesson}" for entry in entries.values() for lesson in entry["lessons"])
    for key in source_per_book:
        by_book[key] = []
    for key in source_per_lesson:
        by_lesson[key] = []
    for key, content in annotations.items():
        category, parts = (metadata[key]["category"], metadata[key]["partsOfSpeech"]) if metadata else classify_fields(content)
        by_book[str(entries[key]["book"])].append(key)
        for lesson in entries[key]["lessons"]:
            by_lesson[f"{entries[key]['book']}-{lesson}"].append(key)
        by_category[category].append(key)
        for part in parts:
            by_pos[part].append(key)
    selected = [key for key, _, _ in SELECTION if key in annotations]
    return {"schemaVersion": 2, "fieldRateScope": "all-source-items; applicable denominators exclude not-applicable",
            "annotatedItemCount": len(annotations), "representativeCount": len(selected),
            "totalSourceEntryCount": len(entries), "notAnnotatedSourceCount": len(entries) - len(annotations),
            "annotatedSourceFraction": len(annotations) / len(entries) if entries else 0,
            "allApplicableFieldsAudited": False, "humanReviewEvents": 0, "perField": summarize(annotations),
            "perBook": {key: {"itemCount": len(value), "sourceEntryCount": source_per_book[key], "annotatedFraction": len(value) / source_per_book[key], "perField": summarize(value)} for key, value in sorted(by_book.items())},
            "perLesson": {key: {"itemCount": len(value), "sourceEntryCount": source_per_lesson[key], "annotatedFraction": len(value) / source_per_lesson[key], "perField": summarize(value)} for key, value in sorted(by_lesson.items())},
            "perCategory": {key: {"itemCount": len(value), "perField": summarize(value)} for key, value in sorted(by_category.items())},
            "perPartOfSpeech": {key: {"itemCount": len(value), "perField": summarize(value)} for key, value in sorted(by_pos.items())},
            "partOfSpeechDenominatorNote": "A genuinely ambiguous item may appear under more than one POS; perCategory is mutually exclusive.",
            "representativeFieldCoverage": summarize(selected),
            "limitations": ["Every item has field statuses, not every field has known or reviewed content.",
                            "Known dictionary parses are isolated-form candidates, without contextual sense disambiguation or reliable stress.",
                            "Source Chinese meanings remain source evidence; 35 missing meanings remain unknown.",
                            "Only the existing 39 teaching example drafts and 15 explanation drafts are retained; no invented new example corpus.",
                            "No relationship inferred from prefixes, slash order or similar spelling; source co-listings are preserved as source statements.",
                            "No AI API calls or human-review events performed."]}


def build_corpus(workbook, previous, prior_manifest, morph):
    reject_reviewed_input(previous)
    entries = {entry["sourceKey"]: entry for entry in workbook["entries"]}
    if len(entries) != len(workbook["entries"]):
        raise ValueError("Duplicate source keys in workbook artifact")
    issues = defaultdict(list)
    for issue in workbook["report"]["issues"]:
        issues[issue["sourceKey"]].append(issue)
    dictionary = dictionary_identity(morph)
    code_hash = generator_code_hash()
    annotator = CorpusAnnotator(morph, annotate, SELECTION, VERSION, MORPH_SOURCE)
    annotations, metadata = {}, {}
    cached = 0
    now = datetime.now(timezone.utc).isoformat()
    for key, entry in entries.items():
        row_hash = fingerprint(entry)
        input_hash = fingerprint({"sourceRowFingerprint": row_hash, "issues": issues[key], "generatorVersion": VERSION,
                                  "generatorCodeSha256": code_hash, "dictionary": dictionary})
        before = previous.get(key)
        old_meta = prior_manifest.get("entries", {}).get(key, {})
        if before and old_meta.get("inputFingerprint") == input_hash and old_meta.get("sourceRowFingerprint") == row_hash and old_meta.get("outputFingerprint") == fingerprint(before):
            annotations[key], metadata[key] = before, old_meta
            cached += 1
            continue
        content, analysis = annotator.annotate(entry, issues[key], workbook["workbook"]["sha256"])
        for name, value in content.items():
            old = before.get(name) if before else None
            comparable = {k: v for k, v in old.items() if k != "updatedAt"} if old else None
            value["updatedAt"] = old["updatedAt"] if comparable == value and old.get("updatedAt") else now
        annotations[key] = content
        metadata[key] = {"sourceRowFingerprint": row_hash, "inputFingerprint": input_hash,
                         "outputFingerprint": fingerprint(content), "category": analysis["category"],
                         "partsOfSpeech": analysis["partsOfSpeech"], "evidenceWorkbookSha256": workbook["workbook"]["sha256"]}
    validate(annotations, entries)
    manifest = {"schemaVersion": 2, "generatorVersion": VERSION, "generatorCodeSha256": code_hash,
                "fingerprintAlgorithm": "sha256/canonical-json-utf8/sorted-keys/no-whitespace/ensure_ascii=false",
                "dictionary": dictionary, "sourceWorkbookSha256": workbook["workbook"]["sha256"], "entries": metadata}
    coverage = report_coverage(annotations, entries, metadata)
    coverage["generator"] = {"version": VERSION, "codeSha256": code_hash, "dictionary": dictionary,
                             "sourceWorkbookSha256": workbook["workbook"]["sha256"]}
    return annotations, manifest, coverage, {"cacheHits": cached, "generatedItems": len(entries) - cached}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workbook", type=Path, default=Path("data/processed/workbook.json"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/annotations.json"))
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--report", type=Path, default=Path("artifacts/import/content-coverage.json"))
    args = parser.parse_args()
    manifest_path = args.manifest or args.output.with_name(args.output.stem + ".manifest.json")
    workbook = json.loads(args.workbook.read_text())
    previous = json.loads(args.output.read_text()) if args.output.exists() else {}
    reject_reviewed_input(previous)
    prior_manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    import pymorphy3
    morph = pymorphy3.MorphAnalyzer(lang="ru")
    annotations, manifest, coverage, counts = build_corpus(workbook, previous, prior_manifest, morph)
    write_if_different(args.output, json_bytes(annotations))
    write_if_different(manifest_path, json_bytes(manifest))
    write_if_different(args.report, json_bytes(coverage))
    print(json.dumps({"annotatedItemCount": len(annotations), "representativeCount": coverage["representativeCount"],
                      "categoryCounts": {key: value["itemCount"] for key, value in coverage["perCategory"].items()},
                      "humanReviewEvents": 0, "output": str(args.output), "manifest": str(manifest_path), **counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
