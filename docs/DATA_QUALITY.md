# Data Quality

`hskWords.js` is generated from a classic HSK vocabulary source and contains about 5,000 entries. During review, several early entries showed incorrect pinyin or uncommon dictionary senses for normal HSK learning.

Examples:

| Hanzi | Current issue |
| --- | --- |
| 个 | Listed as `gě`; common HSK particle/measure usage is `ge`. |
| 吗 | Listed as `má`; common question particle is `ma`. |
| 听 | Listed as `yǐn`; common HSK word is `tīng`. |
| 都 | Meaning is a surname entry instead of common `all/both`. |
| 书 | Meaning is an abbreviation entry instead of common `book`. |

## Recommendation

Before using this app seriously as a learning reference, replace or clean the vocabulary data with a source that includes:

- HSK-specific pinyin.
- HSK-specific meanings.
- Part of speech normalized for study use.
- Optional example sentences.
- Clear license information.

## Implementation Options

1. Keep the app code and replace only `hskWords.js`.
2. Add a validation script that checks known HSK 1-3 words against a curated correction list.
3. Store corrections separately and merge them into the generated data at build time.

The app itself can handle better data without major code changes as long as each word has:

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
