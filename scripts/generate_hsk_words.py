#!/usr/bin/env python3
"""Generate hskWords.js from drkameleon/complete-hsk-vocabulary complete.json."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


POS_LABELS = {
    "a": "adjective",
    "ad": "adverb",
    "ag": "adjective",
    "an": "adjective",
    "b": "adjective",
    "c": "conjunction",
    "d": "adverb",
    "dg": "adverb",
    "e": "interjection",
    "f": "directional locality",
    "g": "morpheme",
    "h": "prefix",
    "i": "idiom",
    "j": "abbreviation",
    "k": "suffix",
    "l": "fixed expression",
    "m": "numeral",
    "mg": "numeral",
    "n": "noun",
    "ng": "noun",
    "nr": "personal name",
    "ns": "place name",
    "nt": "organization name",
    "nx": "noun",
    "nz": "proper noun",
    "o": "onomatopoeia",
    "p": "preposition",
    "q": "measure word",
    "r": "pronoun",
    "rg": "pronoun",
    "s": "space word",
    "t": "time word",
    "tg": "time word",
    "u": "particle",
    "v": "verb",
    "vd": "verb",
    "vg": "verb",
    "vn": "verb",
    "w": "symbol",
    "x": "other",
    "y": "particle",
    "z": "descriptive",
}

PREFERRED_POS = [
    "n",
    "v",
    "a",
    "d",
    "q",
    "r",
    "u",
    "y",
    "m",
    "t",
    "c",
    "p",
]

BAD_MEANING_PATTERNS = [
    r"\bsurname\b",
    r"\bvariant of\b",
    r"\bold variant\b",
    r"\babbr\.",
    r"\bused in\b",
    r"\barchaic\b",
    r"\bdialect\b",
    r"\bcoll\.\) what\?",
]

GOOD_MEANING_PATTERNS = [
    r"\bparticle\b",
    r"\bclassifier\b",
    r"\bto\b",
    r"\bnoun\b",
    r"\bbook\b",
    r"\ball\b",
    r"\bboth\b",
    r"\blisten\b",
    r"\bhear\b",
    r"\bquestion particle\b",
    r"\bstill\b",
    r"\byet\b",
]


def old_level(entry: dict) -> int | None:
    levels = []
    for level in entry.get("level", []):
        match = re.fullmatch(r"old-([1-6])", str(level))
        if match:
            levels.append(int(match.group(1)))
    return min(levels) if levels else None


def label_for_pos(codes: list[str], meaning: str = "") -> str:
    text = meaning.lower()
    if "d" in codes and re.search(r"\b(still|yet|all|both|entirely|already)\b", text):
        return "adverb"
    if "v" in codes and text.startswith("to "):
        return "verb"
    if "particle" in text:
        return "particle"
    if "classifier" in text or "measure word" in text:
        return "measure word"
    if not codes:
        return "other"
    for code in PREFERRED_POS:
        if code in codes:
            return POS_LABELS.get(code, "other")
    return POS_LABELS.get(codes[0], "other")


def form_score(form: dict, entry: dict) -> int:
    text = "; ".join(form.get("meanings", [])).lower()
    pinyin = form.get("transcriptions", {}).get("pinyin", "")
    score = 0

    if pinyin and pinyin[0].islower():
        score += 8
    if "variant" not in text:
        score += 4
    if "surname" not in text:
        score += 4

    for pattern in GOOD_MEANING_PATTERNS:
        if re.search(pattern, text):
            score += 3
    for pattern in BAD_MEANING_PATTERNS:
        if re.search(pattern, text):
            score -= 8

    if entry.get("pos"):
        if "y" in entry["pos"] or "u" in entry["pos"]:
            if "particle" in text:
                score += 12
        if "q" in entry["pos"] and ("classifier" in text or "measure word" in text):
            score += 10
        if "d" in entry["pos"] and re.search(r"\b(still|yet|all|both|entirely|already)\b", text):
            score += 8

    return score


def best_form(entry: dict) -> dict:
    forms = entry.get("forms") or []
    if not forms:
        return {}
    return max(forms, key=lambda form: form_score(form, entry))


def meaning_for(form: dict) -> str:
    meanings = [m.strip() for m in form.get("meanings", []) if str(m).strip()]
    return "; ".join(meanings) if meanings else ""


def generate(source_path: Path) -> list[dict]:
    source = json.loads(source_path.read_text(encoding="utf-8"))
    generated = []

    for entry in source:
        level = old_level(entry)
        if level is None:
            continue

        form = best_form(entry)
        transcriptions = form.get("transcriptions", {})
        pinyin = transcriptions.get("pinyin", "")
        meaning = meaning_for(form)
        if not pinyin or not meaning:
            continue

        generated.append(
            {
                "_frequency": entry.get("frequency") or 999999,
                "hanzi": entry["simplified"],
                "pinyin": pinyin,
                "meaning": meaning,
                "partOfSpeech": label_for_pos(entry.get("pos", []), meaning),
                "level": level,
            }
        )

    generated.sort(key=lambda item: (item["level"], item["_frequency"], item["hanzi"]))
    for index, item in enumerate(generated, start=1):
        del item["_frequency"]
        item["id"] = index
    return generated


def write_js(words: list[dict], output_path: Path) -> None:
    with output_path.open("w", encoding="utf-8") as handle:
        handle.write("// Complete classic HSK 2.0 vocabulary levels 1-6.\n")
        handle.write("// Source: https://github.com/drkameleon/complete-hsk-vocabulary (MIT License).\n")
        handle.write("// Generated from complete.json by scripts/generate_hsk_words.py.\n")
        handle.write("// The generator chooses the best learner-facing form when an entry has multiple dictionary forms.\n\n")
        handle.write("export const HSK_WORDS = ")
        json.dump(words, handle, ensure_ascii=False, indent=2)
        handle.write(";\n\n")
        handle.write("export const HSK_LEVELS = [1, 2, 3, 4, 5, 6];\n")


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: generate_hsk_words.py <complete.json> <hskWords.js>", file=sys.stderr)
        return 2

    words = generate(Path(sys.argv[1]))
    write_js(words, Path(sys.argv[2]))
    print(f"generated {len(words)} HSK words")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
