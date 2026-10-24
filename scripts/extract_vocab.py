#!/usr/bin/env python3
"""Read original OOXML, preserving source text, formulas, provenance and drawings.

Never opens or rewrites the workbook with a spreadsheet authoring library.
Pillow is used only to derive separate image thumbnails; original bytes stay intact.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

NS = {
    "x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p": "http://schemas.openxmlformats.org/package/2006/relationships",
    "d": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}
FIELDS = ["序号", "册数", "课次", "俄语词条", "中文释义", "词性与词形", "书内页码", "PDF页码", "原表链接", "收录来源", "备注", "检索词条（无重音）"]
KNOWN_ASPECT_DISPUTES = {"отбить", "отделаться", "откликнуться", "попереть", "постелить", "прописать"}
MISSING_MEANING = "（原表未提供中文释义）"
EXPECTED = {"byteSize": 54928784, "sha256": "89abe760407bb13fb60af1d0db6956b0c419e79ca5d3b26ea7d9511bdc4c07e6", "sourceEntryCount": 4835, "bookCount": 6, "lessonCount": 69, "associationCount": 4838, "assetCount": 108, "referencedAnchorCount": 104, "missingMeaningCount": 35, "morphologyNonemptyCount": 577, "knownAspectDisputeCount": 6}


class ImportFailure(ValueError):
    pass


@dataclass(frozen=True)
class Cell:
    reference: str
    value: str
    formula: str | None = None
    cell_type: str | None = None


def col_number(reference: str) -> int:
    m = re.fullmatch(r"\$?([A-Za-z]+)\$?([1-9][0-9]*)", reference)
    if not m:
        raise ImportFailure(f"Invalid cell reference: {reference!r}")
    value = 0
    for c in m[1].upper():
        value = value * 26 + ord(c) - 64
    return value


def row_number(reference: str) -> int:
    col_number(reference)
    return int(re.search(r"[0-9]+$", reference)[0])


def normalize_search(value: str) -> str:
    # Remove only Russian stress marks; keep diaeresis/breve in ё and й.
    return unicodedata.normalize("NFC", value).replace("\u0301", "").replace("\u0300", "").casefold()


def parse_lessons(value: str) -> list[int]:
    text = value.strip()
    if not re.fullmatch(r"[1-9][0-9]*(?:\s*[、,，;/；]\s*[1-9][0-9]*)*", text):
        raise ImportFailure(f"Unrecognized lesson list {value!r}; do not guess a range or discard it")
    numbers = [int(v) for v in re.split(r"\s*[、,，;/；]\s*", text)]
    if len(set(numbers)) != len(numbers):
        raise ImportFailure(f"Duplicate lesson within source list {value!r}")
    return numbers


def parse_hyperlink(formula: str) -> tuple[str, str]:
    # Read the literal target of HYPERLINK nested in IFERROR. No evaluation.
    match = re.search(r'\bHYPERLINK\s*\(\s*"((?:[^\"]|\"\")*)"', formula, re.I)
    if not match:
        raise ImportFailure("Source-link formula has no literal HYPERLINK target")
    target = match[1].replace('""', '"')
    if not target.startswith("#"):
        raise ImportFailure("External source-link targets are not accepted")
    match = re.fullmatch(r"#(?:'((?:[^']|'')+)'|([^!]+))!(\$?[A-Za-z]+\$?[1-9][0-9]*)", target)
    if not match:
        raise ImportFailure(f"Unrecognized source anchor {target!r}")
    sheet = (match[1] or match[2]).replace("''", "'")
    return sheet, match[3].replace("$", "").upper()


def resolve_part(source_part: str, target: str) -> str:
    result = posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join(posixpath.dirname(source_part), target))
    if result.startswith("../") or result.startswith("/"):
        raise ImportFailure("OOXML relationship escapes the package")
    return result


def rels_part(part: str) -> str:
    return str(PurePosixPath(part).parent / "_rels" / (PurePosixPath(part).name + ".rels"))


def relationships(z: zipfile.ZipFile, part: str) -> dict[str, dict[str, str]]:
    path = rels_part(part)
    if path not in z.namelist():
        return {}
    rows = ET.fromstring(z.read(path)).findall("p:Relationship", NS)
    result = {}
    for row in rows:
        attrs = dict(row.attrib)
        if attrs.get("TargetMode") != "External":
            attrs["resolved"] = resolve_part(part, attrs["Target"])
        result[attrs["Id"]] = attrs
    return result


def shared_strings(z: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in z.namelist():
        return []
    return ["".join(t.text or "" for t in [*node.findall("x:t", NS), *node.findall("x:r/x:t", NS)]) for node in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("x:si", NS)]


def read_sheet(z: zipfile.ZipFile, path: str, strings: list[str]) -> tuple[ET.Element, dict[int, dict[int, Cell]]]:
    root = ET.fromstring(z.read(path))
    rows = {}
    for row in root.findall("x:sheetData/x:row", NS):
        cells = {}
        for cell in row.findall("x:c", NS):
            ref = cell.attrib["r"]
            kind = cell.get("t")
            value = cell.findtext("x:v", default="", namespaces=NS)
            if kind == "s":
                try:
                    value = strings[int(value)]
                except (IndexError, ValueError) as exc:
                    raise ImportFailure(f"Broken shared string in {path}!{ref}") from exc
            elif kind == "inlineStr":
                inline = cell.find("x:is", NS)
                value = "".join(t.text or "" for t in [*inline.findall("x:t", NS), *inline.findall("x:r/x:t", NS)]) if inline is not None else ""
            formula = cell.findtext("x:f", default=None, namespaces=NS)
            cells[col_number(ref)] = Cell(ref, value, formula, kind)
        rows[int(row.attrib["r"])] = cells
    return root, rows


def identify_header(rows: dict[int, dict[int, Cell]], required: list[str]) -> tuple[int, dict[str, int]]:
    for number, cells in rows.items():
        lookup = {cell.value.strip(): column for column, cell in cells.items()}
        if all(label in lookup for label in required):
            if len([cell for cell in cells.values() if cell.value.strip() in required]) != len(required):
                raise ImportFailure(f"Duplicate required header at row {number}")
            return number, lookup
    raise ImportFailure(f"Header not found by labels: {', '.join(required)}")


def get_value(cells: dict[int, Cell], index: int) -> str:
    return cells[index].value if index in cells else ""


def source_documents(rows: dict[int, dict[int, Cell]]) -> list[dict]:
    header_row, columns = identify_header(rows, ["册数", "来源文件", "总表PDF页码", "总表书内页码", "状态"])
    documents = []
    for number, cells in rows.items():
        if number <= header_row:
            continue
        book = get_value(cells, columns["册数"])
        # This is one contiguous labelled table; a later page-index table also
        # starts with numeric book values but has a different schema.
        if not book.isdigit():
            if documents:
                break
            continue
        if book.isdigit():
            name = get_value(cells, columns["来源文件"])
            if not name:
                raise ImportFailure(f"Missing original document name at provenance row {number}")
            documents.append({
                "id": f"dongfang-b{book}-doc-{hashlib.sha256(name.encode()).hexdigest()[:12]}",
                "book": int(book), "fileName": name,
                "pdfPageRange": get_value(cells, columns["总表PDF页码"]),
                "printedPageRange": get_value(cells, columns["总表书内页码"]),
                "coverageStatus": get_value(cells, columns["状态"]),
                "sourceSheet": "来源与使用", "sourceRow": number,
                "isExcerpt": "摘录" in get_value(cells, columns["状态"]),
            })
    if len({d["book"] for d in documents}) != len(documents):
        raise ImportFailure("Duplicate source-document book; needs explicit identity mapping")
    return documents


def title_regions(rows: dict[int, dict[int, Cell]]) -> list[dict]:
    titles = []
    for number, cells in rows.items():
        unique = {cell.value for cell in cells.values() if re.match(r"第\d+册\s*\|", cell.value)}
        if not unique:
            continue
        if len(unique) != 1:
            raise ImportFailure(f"Multiple source-page titles at worksheet row {number}")
        title = unique.pop()
        # Workbook merged ranges duplicate values into adjacent cells/rows.
        if titles and titles[-1]["text"] == title and titles[-1]["lastRow"] + 1 == number:
            titles[-1]["lastRow"] = number
        else:
            titles.append({"row": number, "lastRow": number, "text": title})
    return titles


def write_if_different(path: Path, content: bytes) -> None:
    if path.exists() and path.read_bytes() == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(content)
    os.replace(temporary, path)


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def extract_images(z: zipfile.ZipFile, sheets: dict, documents: list[dict], asset_dir: Path) -> tuple[list[dict], dict, list[dict]]:
    try:
        from PIL import Image, ImageOps
    except ImportError as exc:
        raise ImportFailure("Pillow is required for separate thumbnails; install the project's pinned Python requirements") from exc
    docs = {d["fileName"]: d["id"] for d in documents}
    assets, anchor_map, evidence = [], {}, []
    for sheet_name, sheet in sheets.items():
        titles = title_regions(sheet["rows"])
        for drawing in sheet["root"].findall("x:drawing", NS):
            rel = relationships(z, sheet["path"]).get(drawing.get(f"{{{NS['r']}}}id"))
            if not rel or "resolved" not in rel:
                raise ImportFailure(f"Missing drawing relationship in {sheet_name}")
            drawing_part = rel["resolved"]
            drawing_rels = relationships(z, drawing_part)
            for i, anchor in enumerate(ET.fromstring(z.read(drawing_part))):
                pictures = anchor.findall("d:pic", NS)
                if not pictures:
                    continue
                position = anchor.find("d:from", NS)
                if position is None:
                    raise ImportFailure("Absolute image position requires explicit mapping; no silent guess")
                row = int(position.findtext("d:row", namespaces=NS)) + 1
                column = int(position.findtext("d:col", namespaces=NS)) + 1
                regions = [t for j, t in enumerate(titles) if t["row"] <= row < (titles[j + 1]["row"] if j + 1 < len(titles) else float("inf"))]
                if len(regions) != 1:
                    raise ImportFailure(f"Image has no unique source title at {sheet_name}!R{row}C{column}")
                title = regions[0]
                document_name = title["text"].split("|")[-1].strip()
                document_id = docs.get(document_name)
                if not document_id:
                    raise ImportFailure(f"Unknown source document in image title: {document_name}")
                for picture in pictures:
                    blip = picture.find("d:blipFill/a:blip", NS)
                    relationship_id = blip.get(f"{{{NS['r']}}}embed") if blip is not None else None
                    image_rel = drawing_rels.get(relationship_id)
                    if not image_rel or "resolved" not in image_rel:
                        raise ImportFailure("Embedded image relationship missing or external")
                    image_part = image_rel["resolved"]
                    content = z.read(image_part)
                    digest = hashlib.sha256(content).hexdigest()
                    identity = hashlib.sha256((sheet_name + "\0" + title["text"] + "\0" + digest).encode()).hexdigest()[:24]
                    asset_id = "source-image-" + identity
                    if any(a["id"] == asset_id for a in assets):
                        # Distinct drawing objects are retained even when their binary is identical.
                        asset_id += f"-object-{i + 1}"
                    suffix = PurePosixPath(image_part).suffix.lower()
                    if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
                        raise ImportFailure(f"Unsupported source image format {suffix}")
                    original_name = "original/" + asset_id + suffix
                    thumb_name = "thumbnails/" + asset_id + ".jpg"
                    write_if_different(asset_dir / original_name, content)
                    with Image.open(io.BytesIO(content)) as image:
                        image.load()
                        dimensions = list(image.size)
                        thumbnail = ImageOps.exif_transpose(image).convert("RGB")
                        thumbnail.thumbnail((420, 620), Image.Resampling.LANCZOS)
                        buffer = io.BytesIO()
                        thumbnail.save(buffer, "JPEG", quality=80, optimize=True)
                        write_if_different(asset_dir / thumb_name, buffer.getvalue())
                    assets.append({"id": asset_id, "fileName": original_name, "thumbnailFileName": thumb_name, "sha256": digest, "sheet": sheet_name, "anchorRow": row, "anchorCol": column, "titles": [title["text"]], "documentId": document_id})
                    for title_row in range(title["row"], title["lastRow"] + 1):
                        for col, cell in sheet["rows"][title_row].items():
                            if cell.value == title["text"]:
                                anchor_map.setdefault((sheet_name, cell.reference), []).append(asset_id)
                    evidence.append({"assetId": asset_id, "drawingPart": drawing_part, "drawingObject": i + 1, "relationshipId": relationship_id, "mediaPart": image_part, "titleRow": title["row"], "anchorRow": row, "dimensions": dimensions, "originalByteSize": len(content), "thumbnailByteSize": len(buffer.getvalue())})
    return assets, anchor_map, evidence


def compare_versions(previous: dict | None, current: dict) -> dict:
    if not previous:
        return {"status": "first-import", "previousSha256": None, "added": [e["sourceKey"] for e in current["entries"]], "removed": [], "changed": [], "identityConflicts": [], "requiresIdentityReconciliation": False}
    before = {e["sourceKey"]: e for e in previous["entries"]}
    after = {e["sourceKey"]: e for e in current["entries"]}
    changed, conflicts = [], []
    for key in sorted(before.keys() & after.keys()):
        if before[key] != after[key]:
            fields = [name for name in after[key] if after[key].get(name) != before[key].get(name)]
            changed.append({"sourceKey": key, "fields": fields})
            if before[key]["russian"] != after[key]["russian"] or before[key]["documentId"] != after[key]["documentId"]:
                conflicts.append({"sourceKey": key, "reason": "Source identifier now points to different text/document; reconcile before applying", "previousRussian": before[key]["russian"], "nextRussian": after[key]["russian"]})
    removed = sorted(before.keys() - after.keys())
    added = sorted(after.keys() - before.keys())
    return {"status": "unchanged" if previous["workbook"]["sha256"] == current["workbook"]["sha256"] else "changed-file", "previousSha256": previous["workbook"]["sha256"], "added": added, "removed": removed, "changed": changed, "identityConflicts": conflicts, "requiresIdentityReconciliation": bool(conflicts or removed)}


def extract(file: Path, output_dir: Path, asset_dir: Path, report_dir: Path) -> dict:
    with file.open("rb") as source_stream:
        sha = hashlib.file_digest(source_stream, "sha256").hexdigest()
    with zipfile.ZipFile(file) as z:
        infos = z.infolist()
        if len(infos) > 10000 or sum(i.file_size for i in infos) > 1024 * 1024 * 1024:
            raise ImportFailure("Workbook exceeds bounded extraction limits")
        strings = shared_strings(z)
        workbook_rels = relationships(z, "xl/workbook.xml")
        sheets = {}
        for sheet in ET.fromstring(z.read("xl/workbook.xml")).findall("x:sheets/x:sheet", NS):
            rel = workbook_rels[sheet.get(f"{{{NS['r']}}}id")]
            path = rel["resolved"]
            root, rows = read_sheet(z, path, strings)
            sheets[sheet.get("name")] = {"path": path, "root": root, "rows": rows}
        for required in ("词汇汇总", "来源与使用", "原表图像"):
            if required not in sheets:
                raise ImportFailure(f"Missing sheet {required}")
        documents = source_documents(sheets["来源与使用"]["rows"])
        doc_by_book = {d["book"]: d for d in documents}
        coverage_notes = list(dict.fromkeys(cell.value for cells in sheets["来源与使用"]["rows"].values() for cell in cells.values() if len(cell.value) > 35))
        assets, anchor_map, drawing_evidence = extract_images(z, sheets, documents, asset_dir)
        assets_by_id = {asset["id"]: asset for asset in assets}
        rows = sheets["词汇汇总"]["rows"]
        header_row, columns = identify_header(rows, FIELDS)
        entries, issues, unmapped, referenced_anchors, seen = [], [], [], set(), set()
        for number, cells in rows.items():
            if number <= header_row or not any(cell.value or cell.formula for cell in cells.values()):
                continue
            raw = {name: get_value(cells, column) for name, column in columns.items() if name}
            if not raw["序号"].isdigit() or not raw["册数"].isdigit() or not raw["俄语词条"]:
                raise ImportFailure(f"Unexpected non-source content below header at row {number}; no row was dropped")
            book = int(raw["册数"])
            if book not in doc_by_book:
                raise ImportFailure(f"No source-document identity for book {book}")
            key = f"dongfang:b{book}:s{raw['序号']}"
            if key in seen:
                raise ImportFailure(f"Duplicate source mapping key {key}")
            seen.add(key)
            link_cell = cells.get(columns["原表链接"])
            formula = link_cell.formula or "" if link_cell else ""
            try:
                anchor = parse_hyperlink(formula)
                referenced_anchors.add(anchor)
                asset_ids = anchor_map.get(anchor, [])
                if not asset_ids:
                    raise ImportFailure(f"No drawing for source anchor {anchor}")
                if len(asset_ids) != 1:
                    raise ImportFailure(f"Ambiguous drawing mapping for source anchor {anchor}")
                asset = assets_by_id[asset_ids[0]]
                title_pages = re.search(r"第(\d+)册.*PDF (\d+)页 · 书内 (\d+)页", asset["titles"][0])
                if not title_pages or (int(title_pages[1]), title_pages[2], title_pages[3], asset["documentId"]) != (book, raw["PDF页码"], raw["书内页码"], doc_by_book[book]["id"]):
                    raise ImportFailure(f"Original image title disagrees with row document/book/page at {anchor}")
            except ImportFailure as exc:
                asset_ids = []
                unmapped.append({"sourceKey": key, "rowNumber": number, "reason": str(exc), "formula": formula})
            missing = raw["中文释义"].strip() in {"", MISSING_MEANING}
            known_aspect = book == 5 and normalize_search(raw["俄语词条"]) in KNOWN_ASPECT_DISPUTES
            dispute = known_aspect or bool(re.search(r"疑|可能有误|不一致|排印|笔误", raw["备注"]))
            entry = {"sourceKey": key, "rowNumber": number, "serial": raw["序号"], "book": book, "lessons": parse_lessons(raw["课次"]), "lessonRaw": raw["课次"], "russian": raw["俄语词条"], "chinese": raw["中文释义"], "morphology": raw["词性与词形"], "bookPage": raw["书内页码"], "pdfPage": raw["PDF页码"], "originalLinkFormula": formula, "sourceLabel": raw["收录来源"], "notes": raw["备注"], "searchOriginal": raw["检索词条（无重音）"], "rawColumns": raw, "documentId": doc_by_book[book]["id"], "assetIds": asset_ids, "missingMeaning": missing, "disputed": dispute}
            entries.append(entry)
            for code, condition, reason in [("missing-meaning", missing, "原表未提供中文释义，不能用于中俄选择题"), ("aspect-dispute", known_aspect, "原书体标记或配对存在疑误，不能作为已确认语法答案"), ("source-dispute", dispute and not known_aspect, "原书备注含疑误，保留原文等待核查")]:
                if condition:
                    affected_fields = ["aspect", "aspectPairs"] if code == "aspect-dispute" else ["russian"] if "ручье" in entry["russian"] else ["chinese"]
                    issues.append({"sourceKey": key, "rowNumber": number, "book": book, "lessons": entry["lessons"], "russian": entry["russian"], "code": code, "affectedFields": affected_fields, "reason": reason, "sourceNote": entry["notes"]})
        books = Counter(e["book"] for e in entries)
        lessons = Counter((e["book"], lesson) for e in entries for lesson in e["lessons"])
        referenced_ids = {asset for entry in entries for asset in entry["assetIds"]}
        meaning_blocked = {issue["sourceKey"] for issue in issues if any(field in {"russian", "chinese"} for field in issue["affectedFields"])}
        report = {
            "sourceEntryCount": len(entries), "bookCount": len(books), "lessonCount": len(lessons), "associationCount": sum(lessons.values()),
            "assetCount": len(assets), "referencedAssetCount": len(referenced_ids), "referencedAnchorCount": len(referenced_anchors), "missingMeaningCount": sum(e["missingMeaning"] for e in entries), "morphologyNonemptyCount": sum(bool(e["morphology"]) for e in entries),
            "disputedEntryCount": sum(e["disputed"] for e in entries), "knownAspectDisputeCount": sum(i["code"] == "aspect-dispute" for i in issues),
            "headerRow": header_row, "sourceRowRange": [min(e["rowNumber"] for e in entries), max(e["rowNumber"] for e in entries)],
            "perBook": [{"book": b, "sourceEntryCount": count, "lessonCount": sum(k[0] == b for k in lessons), "associationCount": sum(n for k, n in lessons.items() if k[0] == b)} for b, count in sorted(books.items())],
            "meaningPracticeEligibleCount": len(entries) - len(meaning_blocked),
            "perLesson": [{"book": b, "lesson": lesson, "sourceEntryCount": count, "practiceEligibleCount": sum(e["book"] == b and lesson in e["lessons"] and e["sourceKey"] not in meaning_blocked for e in entries)} for (b, lesson), count in sorted(lessons.items())],
            "sourceDocuments": documents, "issues": issues, "unmappedRows": unmapped,
            "unreferencedAssetIds": [a["id"] for a in assets if a["id"] not in referenced_ids],
            "mappingCoverage": {"mappedSourceRows": len(entries) - len(unmapped), "totalSourceRows": len(entries), "fraction": (len(entries) - len(unmapped)) / len(entries)},
            "multiLessonRows": [{"sourceKey": e["sourceKey"], "russian": e["russian"], "book": e["book"], "lessons": e["lessons"]} for e in entries if len(e["lessons"]) > 1],
            "coverageLimitations": coverage_notes,
            "countDefinitions": {"sourceEntry": "One original workbook row; may contain a phrase or aspect pair", "lessonAssociation": "One source row linked to one lesson", "lexeme": "Not split or inferred by this extractor", "sense": "Not merged or inferred by this extractor", "learningItem": "Created by database importer, not extraction", "card": "Created by learning engine, not extraction"},
        }
        observed = {**report, "byteSize": file.stat().st_size, "sha256": sha}
        report["providedBaselineDifferences"] = [{"field": k, "expected": v, "observed": observed[k]} for k, v in EXPECTED.items() if observed[k] != v]
        output = {"schemaVersion": 1, "workbook": {"sha256": sha, "fileName": file.name, "byteSize": file.stat().st_size, "sheets": list(sheets), "coverageNotes": coverage_notes}, "entries": entries, "assets": assets, "report": report}
    previous_path = output_dir / "workbook.json"
    previous = json.loads(previous_path.read_text()) if previous_path.exists() else None
    comparison = compare_versions(previous, output)
    # Reports persist even when the import is rejected, but last valid output stays intact.
    write_if_different(report_dir / "import-report.json", json_bytes({"workbook": output["workbook"], **report}))
    write_if_different(report_dir / "version-diff.json", json_bytes(comparison))
    write_if_different(report_dir / "drawing-mapping.json", json_bytes(drawing_evidence))
    write_if_different(report_dir / "issues.json", json_bytes(issues))
    if unmapped:
        raise ImportFailure(f"{len(unmapped)} source rows have no unambiguous original image; see {report_dir / 'import-report.json'}")
    if comparison["requiresIdentityReconciliation"]:
        write_if_different(output_dir / ("candidate-" + sha + ".json"), json_bytes(output))
        raise ImportFailure("New file has identity conflicts/removals. Candidate retained; reconcile mappings before replacing workbook.json")
    write_if_different(previous_path, json_bytes(output))
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, default=os.environ.get("VOCAB_SOURCE_PATH", "data/source/东方俄语词汇汇总_第1至6册.xlsx"))
    parser.add_argument("--output-dir", type=Path, default=Path("data/processed"))
    parser.add_argument("--asset-dir", type=Path, default=Path("data/assets"))
    parser.add_argument("--report-dir", type=Path, default=Path("artifacts/import"))
    args = parser.parse_args()
    try:
        output = extract(args.file, args.output_dir, args.asset_dir, args.report_dir)
    except (ImportFailure, OSError, ET.ParseError, zipfile.BadZipFile) as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps({"file": output["workbook"]["fileName"], "sha256": output["workbook"]["sha256"], **{k: output["report"][k] for k in ("sourceEntryCount", "bookCount", "lessonCount", "associationCount", "assetCount", "referencedAnchorCount", "missingMeaningCount", "knownAspectDisputeCount", "disputedEntryCount", "providedBaselineDifferences")}}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
