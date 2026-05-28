# Vocabulary Data

## Sources

The app ships vocabulary from two well-maintained open-source HSK datasets:

| Repository | License | Coverage |
|---|---|---|
| [`drkameleon/complete-hsk-vocabulary`](https://github.com/drkameleon/complete-hsk-vocabulary) | MIT | Classic HSK 2.0 levels 1–6 and new HSK 3.0 |
| [`elkmovie/hsk30`](https://github.com/elkmovie/hsk30) | — | New HSK 3.0 (alternative reference) |

The app currently uses **classic HSK 2.0 levels 1–6** (approximately 5,000 words). The new HSK 3.0 levels are present in the upstream source and can be included by extending the generator.

## Why a Generator Is Needed

The upstream `complete.json` can include multiple dictionary forms for a single simplified character. For example, a character's entry might list a surname sense, an archaic variant, and the common learner sense — all under the same hanzi. Showing the wrong form on a flashcard would confuse a learner.

`scripts/generate_hsk_words.py` scores each form and selects the best learner-facing entry by preferring:

- Lowercase pinyin over capitalized proper-name forms.
- Definitions containing `particle`, `classifier`, or `to` (verb marker).
- Common adverb senses like `still`, `all`, `both`, and `yet`.
- Definitions that avoid `surname`, `variant`, `archaic`, `abbreviation`, and `dialect` senses.

## Word Object Format

Each entry in `src/hskWords.js` has this shape:

```js
{
  id: 42,                  // sequential integer, stable within a generation
  hanzi: "书",
  pinyin: "shū",
  meaning: "book; letter; document",
  partOfSpeech: "noun",    // see POS_LABELS in the generator for all values
  level: 3                 // 1–6 (classic HSK 2.0)
}
```

## Verified Entries

These entries were manually checked after generation to confirm the correct learner-facing form was selected:

| Hanzi | Pinyin | Meaning |
|---|---|---|
| 个 | `gè` | classifier used before a noun without a specific classifier |
| 吗 | `ma` | question particle |
| 听 | `tīng` | to listen to; to hear |
| 都 | `dōu` | all; both; entirely |
| 书 | `shū` | book; letter; document |
| 还 | `hái` | still; yet |

## Regenerating hskWords.js

Download the upstream source:

```bash
curl -L -o /tmp/complete-hsk-vocabulary.json \
  https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.json
```

Run the generator:

```bash
python3 scripts/generate_hsk_words.py /tmp/complete-hsk-vocabulary.json src/hskWords.js
```

The generator prints the word count on success. Commit the updated `src/hskWords.js`.

## Adding HSK 3.0 Support

To include new HSK 3.0 levels, update `old_level()` in `generate_hsk_words.py` to also match `new-*` level tags from the source data, then extend `HSK_LEVELS` in the output and the `DeckBar` component in `src/HSKFlashcards.jsx`.
