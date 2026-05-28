# Vocabulary Data

`hskWords.js` is generated from `complete.json` in [`drkameleon/complete-hsk-vocabulary`](https://github.com/drkameleon/complete-hsk-vocabulary), which provides complete HSK 2.0 and HSK 3.0 vocabulary data under the MIT license.

The app currently uses classic HSK 2.0 levels 1-6.

## Why A Generator Is Needed

The source data can contain multiple dictionary forms for one simplified word. For example, a word may include a surname, archaic sense, variant spelling, or alternate pronunciation before the common HSK learning sense. The app should show the learner-facing form.

The generator in `scripts/generate_hsk_words.py` scores each form and prefers:

- Lowercase pinyin over proper-name forms.
- Particle meanings for particle entries.
- Classifier meanings for measure words.
- Common adverb meanings such as `still`, `all`, `both`, and `yet`.
- Definitions that avoid surname, variant, abbreviation, and archaic-only senses.

## Corrected Examples

These entries were checked after regeneration:

| Hanzi | Generated pinyin | Generated meaning |
| --- | --- |
| 个 | `gè` | classifier used before a noun without a specific classifier |
| 吗 | `ma` | question particle |
| 听 | `tīng` | to listen to; to hear |
| 都 | `dōu` | all; both; entirely |
| 书 | `shū` | book; letter; document |
| 还 | `hái` | still; yet |

## Regeneration

Download the canonical source JSON:

```bash
curl -L -o /tmp/complete-hsk-vocabulary.json https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.json
```

Regenerate the app data:

```bash
python3 scripts/generate_hsk_words.py /tmp/complete-hsk-vocabulary.json hskWords.js
```

The output format remains:

```js
{
  id,
  hanzi,
  pinyin,
  meaning,
  partOfSpeech,
  level
}
```
