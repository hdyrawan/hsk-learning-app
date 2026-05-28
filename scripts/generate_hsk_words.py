#!/usr/bin/env python3
"""Generate hskWords.js from drkameleon/complete-hsk-vocabulary complete.json.

Produces two word sets from the same source file:
  - Classic HSK 2.0  levels 1–6  (~4,998 words, tagged old-1 … old-6)
  - New    HSK 3.0  levels N1–N7 (~10,969 words, tagged new-1 … new-7)

Words that appear in both standards get separate entries so each standard
is self-contained when selected in the app.
"""

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
    "n", "v", "a", "d", "q", "r", "u", "y", "m", "t", "c", "p",
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
    """Return the lowest classic HSK 2.0 level (1–6) for this entry, or None."""
    levels = []
    for level in entry.get("level", []):
        match = re.fullmatch(r"old-([1-6])", str(level))
        if match:
            levels.append(int(match.group(1)))
    return min(levels) if levels else None


def new_level(entry: dict) -> str | None:
    """Return the lowest new HSK 3.0 level (N1–N7) for this entry, or None."""
    levels = []
    for level in entry.get("level", []):
        match = re.fullmatch(r"new-([1-7])", str(level))
        if match:
            levels.append(int(match.group(1)))
    return f"N{min(levels)}" if levels else None


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


def build_word(entry: dict, level: int | str) -> dict | None:
    form = best_form(entry)
    transcriptions = form.get("transcriptions", {})
    pinyin = transcriptions.get("pinyin", "")
    meaning = meaning_for(form)
    if not pinyin or not meaning:
        return None
    return {
        "_frequency": entry.get("frequency") or 999999,
        "hanzi": entry["simplified"],
        "pinyin": pinyin,
        "meaning": meaning,
        "partOfSpeech": label_for_pos(entry.get("pos", []), meaning),
        "level": level,
    }


def generate(source_path: Path) -> list[dict]:
    source = json.loads(source_path.read_text(encoding="utf-8"))

    classic_words: list[dict] = []
    new_words: list[dict] = []

    for entry in source:
        cl = old_level(entry)
        nl = new_level(entry)

        if cl is not None:
            word = build_word(entry, cl)
            if word:
                classic_words.append(word)

        if nl is not None:
            word = build_word(entry, nl)
            if word:
                new_words.append(word)

    def sort_key_classic(item: dict):
        return (item["level"], item["_frequency"], item["hanzi"])

    def sort_key_new(item: dict):
        return (int(item["level"][1:]), item["_frequency"], item["hanzi"])

    classic_words.sort(key=sort_key_classic)
    new_words.sort(key=sort_key_new)

    all_words = classic_words + new_words
    for index, item in enumerate(all_words, start=1):
        del item["_frequency"]
        item["id"] = index

    return all_words


def write_js(words: list[dict], output_path: Path) -> None:
    classic = [w for w in words if isinstance(w["level"], int)]
    new_hsk = [w for w in words if isinstance(w["level"], str) and w["level"].startswith("N")]

    with output_path.open("w", encoding="utf-8") as f:
        f.write("// HSK vocabulary — classic HSK 2.0 (levels 1–6) and new HSK 3.0 (levels N1–N7).\n")
        f.write("// Source: https://github.com/drkameleon/complete-hsk-vocabulary (MIT License).\n")
        f.write("// Generated from complete.json by scripts/generate_hsk_words.py.\n")
        f.write("// Do not edit this file directly — run the generator script to regenerate.\n\n")
        f.write("export const HSK_WORDS = ")
        json.dump(words, f, ensure_ascii=False, indent=2)
        f.write(";\n\n")
        f.write("export const HSK_CLASSIC_LEVELS = [1, 2, 3, 4, 5, 6];\n")
        f.write('export const HSK_NEW_LEVELS = ["N1", "N2", "N3", "N4", "N5", "N6", "N7"];\n')
        f.write("export const HSK_LEVELS = [...HSK_CLASSIC_LEVELS, ...HSK_NEW_LEVELS];\n")

    print(f"Classic HSK 2.0: {len(classic)} words")
    print(f"New HSK 3.0:     {len(new_hsk)} words")
    print(f"Total:           {len(words)} words")


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: generate_hsk_words.py <complete.json> <hskWords.js>", file=sys.stderr)
        return 2

    words = generate(Path(sys.argv[1]))
    write_js(words, Path(sys.argv[2]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
