import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { HSK_WORDS, HSK_CLASSIC_LEVELS, HSK_NEW_LEVELS } from "./hskWords";
import { HSK_EXAMPLES } from "./hskExamples";

/* ================================================================== */
/*  Supports both classic HSK 2.0 (levels 1–6, ~5,000 words) and      */
/*  new HSK 3.0 (levels N1–N7, ~11,000 words). Select which levels    */
/*  are active with the deck bar at the top. Classic level 3 is on by  */
/*  default. Custom words you add are always included.                 */
/* ================================================================== */

const PARTS_OF_SPEECH = [
  "noun", "verb", "adjective", "adverb", "measure word",
  "conjunction", "preposition", "pronoun", "particle", "other",
];

/* ================================================================== */
/*  SPACED-REPETITION LOGIC                                            */
/*  Level 0 = New, 1 = Learning, 2 = Familiar, 3 = Mastered.           */
/* ================================================================== */
const DAY_MS = 24 * 60 * 60 * 1000;
const SRS_LEVELS = ["New", "Learning", "Familiar", "Mastered"];
const SRS_INTERVAL_DAYS = [0, 1, 3, 7];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function blankState() {
  return { level: 0, nextReview: 0, lastReviewed: 0, correctCount: 0, incorrectCount: 0 };
}
function applyAnswer(prev, correct) {
  const state = prev || blankState();
  const nextLevel = correct ? Math.min(3, state.level + 1) : Math.max(1, state.level - 1);
  return {
    level: nextLevel,
    nextReview: Date.now() + SRS_INTERVAL_DAYS[nextLevel] * DAY_MS,
    lastReviewed: Date.now(),
    correctCount: state.correctCount + (correct ? 1 : 0),
    incorrectCount: state.incorrectCount + (correct ? 0 : 1),
  };
}
function isDue(progress, cardId, now = Date.now()) {
  const s = progress[cardId];
  return !s || s.nextReview <= now;
}
function levelOf(progress, cardId) {
  return progress[cardId]?.level ?? 0;
}

/* ================================================================== */
/*  localStorage HOOK                                                  */
/* ================================================================== */
function usePersistedState(key, defaultValue) {
  const [state, setState] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved !== null ? JSON.parse(saved) : defaultValue;
    } catch { return defaultValue; }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch {}
  }, [key, state]);
  return [state, setState];
}

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */
function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
function buildQuizOptions(card, allCards) {
  const same = allCards.filter(c => c.id !== card.id && c.partOfSpeech === card.partOfSpeech);
  const other = allCards.filter(c => c.id !== card.id && c.partOfSpeech !== card.partOfSpeech);
  const distractors = [...shuffleArray(same), ...shuffleArray(other)].slice(0, 3);
  return shuffleArray([card, ...distractors]);
}
let _zhVoice = undefined; // undefined = not yet resolved; null = unavailable

function resolveZhVoice() {
  if (_zhVoice !== undefined) return;
  const voices = window.speechSynthesis.getVoices();
  _zhVoice = voices.find(v => v.lang === "zh-CN")
    || voices.find(v => v.lang === "zh-TW")
    || voices.find(v => v.lang.startsWith("zh"))
    || null;
}

function speak(text) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-CN";
  u.rate = 0.85;
  const doSpeak = () => {
    resolveZhVoice();
    if (_zhVoice) u.voice = _zhVoice;
    synth.speak(u);
  };
  // On some browsers (Chrome) voices load asynchronously on first use.
  if (synth.getVoices().length === 0) {
    synth.addEventListener("voiceschanged", doSpeak, { once: true });
  } else {
    doSpeak();
  }
}
function getTheme(dark) {
  return dark
    ? { bg: "#131210", surface: "#1C1A17", surfaceAlt: "#22201C", text: "#EDE7DC", textMute: "#8A857A", accent: "#D9836F", good: "#7FA86B", border: "#2A2722" }
    : { bg: "#F7F4ED", surface: "#FFFFFF", surfaceAlt: "#EFEBE0", text: "#1A1814", textMute: "#6B665C", accent: "#A33A2A", good: "#4E7A3A", border: "#E6E0D4" };
}
function levelColor(theme, level) {
  return [theme.textMute, "#C9963F", "#5A8FB0", theme.good][level] || theme.textMute;
}

/* ================================================================== */
/*  REUSABLE UI                                                        */
/* ================================================================== */
function Kbd({ theme, children }) {
  return <span style={{ fontFamily: "monospace", padding: "2px 6px", background: theme.surfaceAlt, border: `1px solid ${theme.border}`, borderRadius: 4, marginRight: 4, color: theme.text }}>{children}</span>;
}
function LevelBadge({ theme, level, small }) {
  const color = levelColor(theme, level);
  return <span style={{ fontSize: small ? 10 : 11, letterSpacing: "0.06em", textTransform: "uppercase", padding: small ? "2px 8px" : "3px 10px", borderRadius: 999, background: `${color}1A`, color, whiteSpace: "nowrap", fontWeight: 500 }}>{SRS_LEVELS[level]}</span>;
}
function EmptyState({ theme, hanzi, title, description, children }) {
  return (
    <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "56px 24px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div className="hanzi" style={{ fontSize: 52, color: theme.textMute, marginBottom: 10 }}>{hanzi}</div>
      <div className="display" style={{ fontSize: 18, color: theme.text, fontStyle: "italic" }}>{title}</div>
      <div style={{ fontSize: 13, color: theme.textMute, maxWidth: 340, lineHeight: 1.5 }}>{description}</div>
      {children}
    </div>
  );
}
function Confetti({ pieces = 16 }) {
  const colors = ["#C0392B", "#D68910", "#27AE60", "#2471A3", "#8E44AD", "#E67E22"];
  return (
    <div style={{ position: "relative", height: 56, overflow: "hidden", pointerEvents: "none" }}>
      {Array.from({ length: pieces }).map((_, i) => (
        <span key={i} style={{
          position: "absolute", top: -10, left: `${(i * 6.3) % 100}%`, width: 8, height: 8, borderRadius: 2,
          background: colors[i % colors.length], opacity: 0.95,
          animation: `confetti-fall ${1.2 + (i % 5) * 0.35}s ease-in ${(i % 8) * 0.12}s forwards`,
        }} />
      ))}
    </div>
  );
}
function Button({ theme, variant = "ghost", onClick, disabled, children, style }) {
  const base = { padding: "13px 16px", borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, transition: "background 0.15s, opacity 0.15s, border-color 0.15s" };
  const v = {
    primary: { background: theme.accent, color: "#FFF", border: `1px solid ${theme.accent}` },
    ghost: { background: "transparent", color: theme.text, border: `1px solid ${theme.border}` },
    subtle: { background: "transparent", color: theme.textMute, border: `1px solid ${theme.border}` },
  };
  return <button className={variant === "primary" ? "btn-primary" : "btn-ghost"} onClick={onClick} disabled={disabled} style={{ ...base, ...v[variant], ...style }}>{children}</button>;
}
function PlayButton({ theme, onClick, tiny }) {
  const size = tiny ? 22 : 28;
  return <button onClick={onClick} className="btn-ghost" aria-label="Play pronunciation" title="Play pronunciation" style={{ background: "transparent", border: `1px solid ${theme.border}`, color: theme.textMute, width: size, height: size, borderRadius: 999, fontSize: tiny ? 10 : 12, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>♪</button>;
}
function SearchInput({ theme, value, onChange }) {
  return (
    <div style={{ marginBottom: 20, position: "relative" }}>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="Search hanzi, pinyin, or meaning…"
        style={{ width: "100%", padding: "11px 14px 11px 38px", background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 14, outline: "none", boxSizing: "border-box" }}
        onFocus={e => (e.target.style.borderColor = theme.accent)} onBlur={e => (e.target.style.borderColor = theme.border)} />
      <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: theme.textMute, fontSize: 14, pointerEvents: "none" }}>⌕</span>
    </div>
  );
}
function FilterTabs({ theme, tabs, value, onChange }) {
  return (
    <nav style={{ display: "flex", gap: 18, marginBottom: 16, borderBottom: `1px solid ${theme.border}`, overflowX: "auto" }}>
      {tabs.map(([key, label, count]) => (
        <button key={key} onClick={() => onChange(key)} style={{ background: "transparent", border: "none", padding: "8px 0", fontSize: 14, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap", color: value === key ? theme.text : theme.textMute, borderBottom: `2px solid ${value === key ? theme.accent : "transparent"}`, marginBottom: -1 }}>
          {label} <span style={{ fontSize: 11, opacity: 0.6, fontVariantNumeric: "tabular-nums" }}>{count}</span>
        </button>
      ))}
    </nav>
  );
}
function cardFaceStyle(theme) {
  return { position: "absolute", inset: 0, background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 28, display: "flex", flexDirection: "column", justifyContent: "space-between", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
}
function FontLoader() {
  useEffect(() => {
    const id = "hsk-fonts";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id; link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=IBM+Plex+Sans:wght@400;500;600&family=Noto+Serif+SC:wght@400;500;600&display=swap";
    document.head.appendChild(link);
  }, []);
  return null;
}

/* Examples come from the card itself (user-added custom words) or from the
   curated HSK_EXAMPLES lookup, so nearly every word now shows a real usage
   sentence instead of only custom words. */
function exampleFor(card) {
  if (card.exampleHanzi) {
    return { hanzi: card.exampleHanzi, pinyin: card.examplePinyin || "", english: card.exampleEnglish || "" };
  }
  const ex = HSK_EXAMPLES[card.hanzi];
  if (!ex) return null;
  return { hanzi: ex.hanzi, pinyin: ex.pinyin || "", english: ex.english };
}

/* The example block is shared by Study + Review; it's skipped only when neither
   the card nor the curated lookup has an example for this word. */
function ExampleBlock({ theme, card }) {
  const ex = exampleFor(card);
  if (!ex) return null;
  return (
    <div style={{ paddingTop: 18, borderTop: `1px solid ${theme.border}`, marginTop: 4 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: theme.textMute, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
        Example <PlayButton theme={theme} tiny onClick={(e) => { e.stopPropagation(); speak(ex.hanzi); }} />
      </div>
      <div className="hanzi" style={{ fontSize: 20, color: theme.text, lineHeight: 1.6, marginBottom: 8 }}>{ex.hanzi}</div>
      {ex.pinyin && <div className="display" style={{ fontSize: 15, fontStyle: "italic", lineHeight: 1.5, marginBottom: 6 }}><TonePinyin theme={theme} text={ex.pinyin} /></div>}
      {ex.english && <div style={{ fontSize: 14, color: theme.textMute, lineHeight: 1.5 }}>{ex.english}</div>}
    </div>
  );
}

/* ================================================================== */
/*  PART-OF-SPEECH HELPER + RELATED WORDS                              */
/*  Users who don't know grammar jargon see a plain-language POS        */
/*  explanation, and a hard lone hanzi is shown inside real words so    */
/*  it isn't learned in isolation.                                     */
/* ================================================================== */
const FRIENDLY_POS = {
  "noun":          { cn: "名词", tip: "a person, place, or thing — e.g. water, book, teacher" },
  "verb":          { cn: "动词", tip: "an action or state — e.g. eat, go, be" },
  "adjective":     { cn: "形容词", tip: "describes what something is like — e.g. big, happy, red" },
  "adverb":        { cn: "副词", tip: "how/when/where an action happens — e.g. quickly, often" },
  "measure word":  { cn: "量词", tip: "a counter used with numbers — 一位老师, 三本书" },
  "particle":      { cn: "助词", tip: "a grammar helper word — e.g. 的, 了, 吗" },
  "conjunction":   { cn: "连词", tip: "joins words or clauses — e.g. and, but, because" },
  "preposition":   { cn: "介词", tip: "shows place/time/relation — e.g. in, on, at, from" },
  "pronoun":       { cn: "代词", tip: "stands for a name — e.g. he, she, it, this" },
  "numeral":       { cn: "数词", tip: "a number word — e.g. one, two, three" },
  "time word":     { cn: "时间词", tip: "a time word — e.g. today, now, morning" },
  "interjection":  { cn: "感叹词", tip: "an exclamation — e.g. wow!, oh!" },
  "idiom":         { cn: "成语", tip: "a fixed saying, usually 4 characters" },
  "onomatopoeia":  { cn: "拟声词", tip: "a sound word — e.g. 'bang', 'miaow'" },
  "abbreviation":  { cn: "缩写", tip: "a shortened form" },
  "symbol":        { cn: "符号", tip: "a symbol" },
  "other":         { cn: "其他", tip: "a general word class" },
};
function posHelper(pos) {
  return FRIENDLY_POS[pos] || { cn: "词类", tip: "a word-class label — see it used in the example below" };
}

// Words in the active deck that share a character with this card's hanzi,
// so a hard lone character is seen inside real, usable words.
function RelatedWordsPanel({ theme, card, deck }) {
  const words = useMemo(() => {
    const chars = [...new Set(card.hanzi.split(""))].filter(c => c.trim());
    if (chars.length === 0) return [];
    const seen = new Set();
    const uniq = [];
    for (const w of deck) {
      if (w.id === card.id || w.hanzi === card.hanzi) continue;
      if (!chars.some(ch => w.hanzi.includes(ch))) continue;
      const key = w.hanzi + "|" + w.pinyin;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(w);
    }
    return uniq
      .sort((a, b) => a.hanzi.length - b.hanzi.length || a.hanzi.localeCompare(b.hanzi))
      .slice(0, 5);
  }, [deck, card]);
  if (words.length === 0) return null;
  const label = card.hanzi.length === 1 ? `Words with ${card.hanzi}` : `Words using ${card.hanzi}`;
  return (
    <div style={{ paddingTop: 14, borderTop: `1px solid ${theme.border}`, marginTop: 14 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: theme.textMute, marginBottom: 8 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {words.map(w => (
          <button key={w.id} onClick={(e) => { e.stopPropagation(); speak(w.hanzi); }}
            style={{ display: "flex", alignItems: "center", gap: 10, background: theme.surfaceAlt, border: `1px solid ${theme.border}`, borderRadius: 8, padding: "7px 10px", cursor: "pointer", textAlign: "left" }}>
            <span className="hanzi" style={{ fontSize: 18, color: theme.text, minWidth: 26 }}>{w.hanzi}</span>
            <span className="display" style={{ fontSize: 12, color: theme.textMute, fontStyle: "italic", minWidth: 70, whiteSpace: "nowrap" }}>{w.pinyin}</span>
            <span style={{ fontSize: 12, color: theme.textMute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {w.meaning.split(";")[0].trim()}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  LEARNING-FRIENDLY RENDERING — primary-meaning-first + tone pinyin  */
/* ================================================================== */
function senses(meaning) {
  return String(meaning || "").split(";").map(s => s.trim()).filter(Boolean);
}
function primaryMeaning(meaning) {
  const s = senses(meaning);
  return s.length ? s[0] : String(meaning || "");
}

const TONE_CHAR = {
  "ā":1, "ē":1, "ī":1, "ō":1, "ū":1, "ǖ":1,
  "á":2, "é":2, "í":2, "ó":2, "ú":2, "ǘ":2,
  "ǎ":3, "ě":3, "ǐ":3, "ǒ":3, "ǔ":3, "ǚ":3,
  "à":4, "è":4, "ì":4, "ò":4, "ù":4, "ǜ":4,
};
function syllableTone(syllable) {
  for (const ch of syllable) { const t = TONE_CHAR[ch]; if (t) return t; }
  return 0; // no tone mark = neutral
}
// Color each pinyin syllable by tone (1st≈red, 2nd≈orange, 3rd≈green, 4th≈blue)
// so the reader sees tone at a glance — a standard Chinese-reading aid.
function TonePinyin({ theme, text }) {
  if (!text) return null;
  const tokens = text.split(/\s+/).filter(Boolean);
  const colored = ["", "#C0392B", "#D68910", "#27AE60", "#2471A3"];
  return (
    <>
      {tokens.map((tok, i) => {
        const tone = syllableTone(tok);
        return <span key={i} style={{ color: tone === 0 ? theme.textMute : colored[tone] }}>
          {tok}{i < tokens.length - 1 ? "\u00A0" : ""}
        </span>;
      })}
    </>
  );
}

// Show the primary sense prominently and tuck the remaining senses behind a
// small expander instead of a wall of "a; b; c; d".
function Meaning({ theme, meaning }) {
  const parts = senses(meaning);
  const [more, setMore] = useState(false);
  if (parts.length === 0) return null;
  if (parts.length === 1) return <div style={{ fontSize: 17, color: theme.text, lineHeight: 1.45 }}>{parts[0]}</div>;
  return (
    <div>
      <div style={{ fontSize: 17, color: theme.text, lineHeight: 1.45, display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 8 }}>
        <span>{parts[0]}</span>
        <button onClick={() => setMore(m => !m)}
          style={{ background: "transparent", border: "none", color: theme.accent, fontSize: 12, cursor: "pointer", padding: 0 }}>
          {more ? "less" : `+${parts.length - 1} more`}
        </button>
      </div>
      {more && <div style={{ fontSize: 14, color: theme.textMute, lineHeight: 1.5, marginTop: 6 }}>{parts.slice(1).join(" · ")}</div>}
    </div>
  );
}

/* Shared card-back face used by BOTH Study and Review, so learners get the
   same support (POS helper, tone pinyin, primary meaning, example, related
   words) regardless of which mode they're in. */
function CardBack({ theme, card, deck }) {
  return (
    <div className="card-face card-back" style={{ ...cardFaceStyle(theme), justifyContent: "flex-start", overflow: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="hanzi" style={{ fontSize: 38, fontWeight: 500, color: theme.text, lineHeight: 1 }}>{card.hanzi}</span>
          <PlayButton theme={theme} onClick={(e) => { e.stopPropagation(); speak(card.hanzi); }} />
        </div>
        <span className="display" style={{ fontSize: 13, letterSpacing: "0.02em", textTransform: "none", color: theme.accent, fontStyle: "italic", whiteSpace: "nowrap" }}>{card.partOfSpeech}</span>
      </div>
      <div className="display" style={{ fontSize: 22, fontStyle: "italic", marginBottom: 6, color: theme.text }}><TonePinyin theme={theme} text={card.pinyin} /></div>
      <div style={{ fontSize: 12, color: theme.textMute, marginBottom: 10, lineHeight: 1.5 }}>
        {card.partOfSpeech} · <span className="hanzi">{posHelper(card.partOfSpeech).cn}</span> — {posHelper(card.partOfSpeech).tip}
      </div>
      <div style={{ marginBottom: exampleFor(card) ? 20 : 0 }}><Meaning theme={theme} meaning={card.meaning} /></div>
      <ExampleBlock theme={theme} card={card} />
      <RelatedWordsPanel theme={theme} card={card} deck={deck} />
    </div>
  );
}

/* ================================================================== */
/*  DECK BAR — choose which HSK levels are active.                     */
/*  Two rows: Classic HSK 2.0 (1–6) and New HSK 3.0 (N1–N7).          */
/* ================================================================== */
const LEVEL_ORDER = Object.fromEntries(
  [...HSK_CLASSIC_LEVELS, ...HSK_NEW_LEVELS].map((l, i) => [l, i])
);

function DeckBar({ theme, levels, setLevels, deckSize, levelStats }) {
  const toggle = (lvl) => {
    setLevels(prev => {
      if (prev.includes(lvl)) return prev.length > 1 ? prev.filter(l => l !== lvl) : prev;
      return [...prev, lvl].sort((a, b) => (LEVEL_ORDER[a] ?? 99) - (LEVEL_ORDER[b] ?? 99));
    });
  };

  const row = (rowLevels, label) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap" }}>
      <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: theme.textMute, minWidth: 52, flexShrink: 0 }}>{label}</span>
      {rowLevels.map(lvl => {
        const on = levels.includes(lvl);
        const label = typeof lvl === "string" ? lvl.slice(1) : lvl;
        const st = levelStats[lvl];
        const pct = st && st.total ? st.mastered / st.total : 0;
        return (
          <div key={lvl} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <button onClick={() => toggle(lvl)} className="btn-ghost" title={st ? `${st.mastered}/${st.total} mastered` : undefined}
              style={{ width: 30, height: 30, borderRadius: 999, border: `1px solid ${on ? theme.accent : theme.border}`, background: on ? theme.accent : "transparent", color: on ? "#fff" : theme.textMute, fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
              {label}
            </button>
            <div style={{ width: 26, height: 3, borderRadius: 2, background: theme.border, overflow: "hidden" }}>
              <div style={{ width: `${Math.round(pct * 100)}%`, height: "100%", background: pct >= 1 ? theme.good : theme.accent, transition: "width 0.3s ease" }} />
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
      {row(HSK_CLASSIC_LEVELS, "Classic")}
      {row(HSK_NEW_LEVELS, "New 3.0")}
      <div style={{ fontSize: 12, color: theme.textMute, fontVariantNumeric: "tabular-nums" }}>{deckSize.toLocaleString()} words in deck</div>
    </div>
  );
}

/* ================================================================== */
/*  STUDY VIEW                                                         */
/* ================================================================== */
function StudyView({ deck, progress, onAnswer, reverseMode, theme }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  // Start every study session in a random order so you're not stuck in the
  // fixed pinyin-sorted sequence. The Shuffle button re-randomizes anytime.
  const [order, setOrder] = useState(() => shuffleArray(deck.map(c => c.id)));

  useEffect(() => {
    setOrder(prev => {
      const valid = prev.filter(id => deck.some(c => c.id === id));
      const missing = deck.filter(c => !valid.includes(c.id)).map(c => c.id);
      return [...valid, ...missing];
    });
  }, [deck]);

  const cards = useMemo(() => {
    const byId = new Map(deck.map(c => [c.id, c]));
    let list = order.map(id => byId.get(id)).filter(Boolean);
    if (filter !== "all") {
      const target = SRS_LEVELS.indexOf(filter);
      list = list.filter(c => levelOf(progress, c.id) === target);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(c => c.hanzi.includes(search.trim()) || c.pinyin.toLowerCase().includes(q) || c.meaning.toLowerCase().includes(q));
    }
    return list;
  }, [order, deck, filter, progress, search]);

  useEffect(() => {
    if (cards.length === 0) setIndex(0);
    else if (index >= cards.length) setIndex(index % cards.length);
  }, [cards.length, index]);

  const card = cards[index] || null;
  const next = useCallback(() => { setFlipped(false); setIndex(i => i + 1); }, []);
  const prev = useCallback(() => { setFlipped(false); setIndex(i => (i - 1 + cards.length) % cards.length); }, [cards.length]);
  const grade = useCallback((correct) => { if (!card) return; onAnswer(card.id, correct); next(); }, [card, onAnswer, next]);
  const shuffle = () => { setOrder(shuffleArray(order)); setIndex(0); setFlipped(false); };

  useEffect(() => {
    const handler = (e) => {
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === " ") { e.preventDefault(); setFlipped(f => !f); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
      else if (e.key === "k" || e.key === "K") { e.preventDefault(); grade(true); }
      else if (e.key === "l" || e.key === "L") { e.preventDefault(); grade(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [next, prev, grade]);

  const counts = useMemo(() => {
    const c = { all: deck.length, New: 0, Learning: 0, Familiar: 0, Mastered: 0 };
    deck.forEach(x => { c[SRS_LEVELS[levelOf(progress, x.id)]]++; });
    return c;
  }, [deck, progress]);

  const front = card && (reverseMode
    ? <div style={{ textAlign: "center", padding: "0 16px" }}>
        <div className="display" style={{ fontSize: "clamp(22px,6vw,34px)", lineHeight: 1.35, color: theme.text, fontStyle: "italic" }}>{card.meaning}</div>
        <div style={{ fontSize: 12, color: theme.textMute, marginTop: 14, letterSpacing: "0.08em", textTransform: "uppercase" }}>{card.partOfSpeech}</div>
      </div>
    : <div className="hanzi" style={{ fontSize: "clamp(56px,16vw,118px)", fontWeight: 500, lineHeight: 1.05, color: theme.text, letterSpacing: "0.04em", textAlign: "center" }}>{card.hanzi}</div>);

  return (
    <div>
      <FilterTabs theme={theme} value={filter} onChange={(v) => { setFilter(v); setIndex(0); setFlipped(false); }}
        tabs={[["all", "All", counts.all], ["New", "New", counts.New], ["Learning", "Learning", counts.Learning], ["Familiar", "Familiar", counts.Familiar], ["Mastered", "Mastered", counts.Mastered]]} />
      <SearchInput theme={theme} value={search} onChange={(v) => { setSearch(v); setIndex(0); setFlipped(false); }} />

      {card ? (
        <div style={{ perspective: 2000, marginBottom: 18 }} className="fade-in" key={card.id}>
          <div onClick={() => setFlipped(f => !f)} className={`card-flip ${flipped ? "flipped" : ""}`} style={{ position: "relative", width: "100%", minHeight: 360, cursor: "pointer" }}>
            <div className="card-face" style={cardFaceStyle(theme)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, letterSpacing: "0.12em", color: theme.textMute, textTransform: "uppercase" }}>{reverseMode ? "Recall the hanzi" : `Card ${index + 1} / ${cards.length}`}</span>
                <LevelBadge theme={theme} level={levelOf(progress, card.id)} small />
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>{front}</div>
              <div style={{ textAlign: "center", color: theme.textMute, fontSize: 12, letterSpacing: "0.06em" }}>Tap to reveal · Space to flip</div>
            </div>
            <CardBack theme={theme} card={card} deck={deck} />
          </div>
        </div>
      ) : (
        <EmptyState theme={theme} hanzi="空" title="No cards match" description="Try a different level filter, clear your search, or turn on more HSK levels above." />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <Button theme={theme} variant="ghost" disabled={!card} onClick={() => grade(false)}>Still learning <span style={{ color: theme.textMute, fontSize: 11, marginLeft: 4, fontFamily: "monospace" }}>L</span></Button>
        <Button theme={theme} variant="primary" disabled={!card} onClick={() => grade(true)}>I know this <span style={{ opacity: 0.75, fontSize: 11, marginLeft: 4, fontFamily: "monospace" }}>K</span></Button>
      </div>
      <div className="dual-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Button theme={theme} variant="subtle" disabled={!card} onClick={prev}>← Back</Button>
        <Button theme={theme} variant="subtle" disabled={!card} onClick={next}>Next →</Button>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        <Button theme={theme} variant="subtle" onClick={shuffle}>Shuffle</Button>
      </div>
      <div style={{ fontSize: 11, color: theme.textMute, textAlign: "center", padding: "18px 0 0" }}>
        <Kbd theme={theme}>Space</Kbd> flip <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
        <Kbd theme={theme}>←</Kbd> back <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
        <Kbd theme={theme}>→</Kbd> next <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
        <Kbd theme={theme}>K</Kbd> known <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
        <Kbd theme={theme}>L</Kbd> learning
      </div>
    </div>
  );
}

/* ================================================================== */
/*  QUIZ VIEW                                                          */
/* ================================================================== */
function QuizView({ deck, progress, onAnswer, reverseMode, theme }) {
  const [card, setCard] = useState(null);
  const [options, setOptions] = useState([]);
  const [picked, setPicked] = useState(null);
  const [score, setScore] = useState({ correct: 0, total: 0 });
  const deckSignature = useMemo(() => deck.map(c => c.id).join("|"), [deck]);

  const drawCard = useCallback(() => {
    if (deck.length < 4) { setCard(null); return; }
    const due = deck.filter(c => isDue(progress, c.id));
    const pool = due.length > 0 ? due : deck;
    const weighted = [...pool].sort((a, b) => levelOf(progress, a.id) - levelOf(progress, b.id));
    const top = weighted.slice(0, Math.max(8, Math.ceil(weighted.length / 2)));
    const chosen = top[Math.floor(Math.random() * top.length)];
    setCard(chosen);
    setOptions(buildQuizOptions(chosen, deck));
    setPicked(null);
  }, [deck, progress]);

  useEffect(() => { drawCard(); }, [deckSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (opt) => {
    if (picked) return;
    setPicked(opt.id);
    const correct = opt.id === card.id;
    onAnswer(card.id, correct);
    setScore(s => ({ correct: s.correct + (correct ? 1 : 0), total: s.total + 1 }));
  };

  if (!card) return <EmptyState theme={theme} hanzi="题" title="Need at least 4 words" description="Quiz mode builds multiple-choice questions from the active deck. Turn on an HSK level above or add custom words." />;

  const prompt = reverseMode ? primaryMeaning(card.meaning) : card.hanzi;
  const labelOf = (opt) => reverseMode ? opt.hanzi : primaryMeaning(opt.meaning);

  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <span style={{ fontSize: 12, color: theme.textMute, letterSpacing: "0.06em", textTransform: "uppercase" }}>{reverseMode ? "Pick the hanzi" : "Pick the meaning"}</span>
        <span className="display" style={{ fontSize: 14, color: theme.text, fontVariantNumeric: "tabular-nums" }}>{score.correct}/{score.total}</span>
      </div>
      <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "40px 24px", textAlign: "center", marginBottom: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div className={reverseMode ? "display" : "hanzi"} style={{ fontSize: reverseMode ? "clamp(22px,5.5vw,32px)" : "clamp(56px,14vw,104px)", fontWeight: 500, lineHeight: 1.25, color: theme.text, fontStyle: reverseMode ? "italic" : "normal" }}>{prompt}</div>
        {!reverseMode && <PlayButton theme={theme} onClick={() => speak(card.hanzi)} />}
      </div>
      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        {options.map(opt => {
          const isCorrect = opt.id === card.id, isPicked = picked === opt.id;
          let bg = theme.surface, border = theme.border, color = theme.text;
          if (picked) {
            if (isCorrect) { bg = `${theme.good}1A`; border = theme.good; color = theme.good; }
            else if (isPicked) { bg = `${theme.accent}14`; border = theme.accent; color = theme.accent; }
            else { color = theme.textMute; }
          }
          return (
            <button key={opt.id} onClick={() => choose(opt)} disabled={!!picked} className="quiz-option"
              style={{ textAlign: "left", padding: "15px 18px", borderRadius: 10, border: `1px solid ${border}`, background: bg, color, fontSize: 16, fontWeight: 500, cursor: picked ? "default" : "pointer", fontFamily: reverseMode ? '"Noto Serif SC", serif' : "inherit", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span>{labelOf(opt)}</span>
              {picked && isCorrect && <span style={{ fontSize: 13 }}>✓</span>}
              {picked && isPicked && !isCorrect && <span style={{ fontSize: 13 }}>✗</span>}
            </button>
          );
        })}
      </div>
      {picked && (
        <div className="fade-in" style={{ fontSize: 13, color: theme.textMute, textAlign: "center", marginBottom: 12, lineHeight: 1.5 }}>
          <span className="hanzi" style={{ color: theme.text }}>{card.hanzi}</span>{"  "}
          <span className="display" style={{ fontStyle: "italic" }}>{card.pinyin}</span>{"  ·  "}{card.meaning}
        </div>
      )}
      <Button theme={theme} variant={picked ? "primary" : "subtle"} onClick={drawCard} style={{ width: "100%" }}>{picked ? "Next question →" : "Skip this word"}</Button>
    </div>
  );
}

/* ================================================================== */
/*  TODAY / REVIEW VIEW                                                */
/* ================================================================== */
function ReviewView({ deck, progress, onAnswer, reverseMode, theme }) {
  const due = useMemo(() => deck.filter(c => isDue(progress, c.id)), [deck, progress]);
  const [sessionIds, setSessionIds] = useState(null);
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [done, setDone] = useState(0);

  const breakdown = useMemo(() => {
    const b = { New: 0, Learning: 0, Familiar: 0, Mastered: 0 };
    due.forEach(c => { b[SRS_LEVELS[levelOf(progress, c.id)]]++; });
    return b;
  }, [due, progress]);

  // Cap a single session so a 2,500-word level doesn't become one giant queue.
  const SESSION_CAP = 40;
  const start = () => { setSessionIds(shuffleArray(due.map(c => c.id)).slice(0, SESSION_CAP)); setPos(0); setDone(0); setFlipped(false); };

  if (sessionIds === null) {
    if (due.length === 0) return <EmptyState theme={theme} hanzi="休" title="All caught up" description="Nothing is due right now. Study new words, or come back when cards are scheduled to return." />;
    return (
      <div className="fade-in">
        <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 28, marginBottom: 16, textAlign: "center" }}>
          <div className="display" style={{ fontSize: 46, fontWeight: 600, color: theme.accent, lineHeight: 1 }}>{due.length.toLocaleString()}</div>
          <div style={{ fontSize: 13, color: theme.textMute, marginTop: 6 }}>cards due for review</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
          {SRS_LEVELS.map((lvl, i) => (
            <div key={lvl} style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <LevelBadge theme={theme} level={i} small />
              <span style={{ fontSize: 18, fontWeight: 600, color: theme.text, fontVariantNumeric: "tabular-nums" }}>{breakdown[lvl].toLocaleString()}</span>
            </div>
          ))}
        </div>
        <Button theme={theme} variant="primary" onClick={start} style={{ width: "100%" }}>
          Start review session{due.length > SESSION_CAP ? ` (${SESSION_CAP} cards)` : ""}
        </Button>
      </div>
    );
  }

  const remaining = sessionIds.map(id => deck.find(c => c.id === id)).filter(Boolean);
  const card = remaining[pos] || null;
  if (!card) {
    return (
      <EmptyState theme={theme} hanzi="成" title="Session complete 🎉" description={`You reviewed ${done} ${done === 1 ? "card" : "cards"}. Keep the streak going!`}>
        <Confetti />
        <div style={{ marginTop: 16 }}><Button theme={theme} variant="primary" onClick={() => setSessionIds(null)}>Back to overview</Button></div>
      </EmptyState>
    );
  }
  const grade = (correct) => { onAnswer(card.id, correct); setDone(d => d + 1); setFlipped(false); setPos(p => p + 1); };

  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: theme.textMute, letterSpacing: "0.06em", textTransform: "uppercase" }}>Review session</span>
        <span className="display" style={{ fontSize: 14, color: theme.text, fontVariantNumeric: "tabular-nums" }}>{pos + 1} / {remaining.length}</span>
      </div>
      <div style={{ perspective: 2000, marginBottom: 18 }} key={card.id}>
        <div onClick={() => setFlipped(f => !f)} className={`card-flip ${flipped ? "flipped" : ""}`} style={{ position: "relative", width: "100%", minHeight: 320, cursor: "pointer" }}>
          <div className="card-face" style={cardFaceStyle(theme)}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}><LevelBadge theme={theme} level={levelOf(progress, card.id)} small /></div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {reverseMode
                ? <div className="display" style={{ fontSize: "clamp(22px,6vw,34px)", color: theme.text, fontStyle: "italic", textAlign: "center", padding: "0 16px" }}>{card.meaning}</div>
                : <div className="hanzi" style={{ fontSize: "clamp(56px,15vw,110px)", fontWeight: 500, color: theme.text, letterSpacing: "0.04em" }}>{card.hanzi}</div>}
            </div>
            <div style={{ textAlign: "center", color: theme.textMute, fontSize: 12 }}>Tap to reveal</div>
          </div>
          <CardBack theme={theme} card={card} deck={deck} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Button theme={theme} variant="ghost" onClick={() => grade(false)}>Still learning</Button>
        <Button theme={theme} variant="primary" onClick={() => grade(true)}>I know this</Button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  LIBRARY VIEW (render-capped for large levels)                      */
/* ================================================================== */
const LIBRARY_CAP = 150;
function LibraryView({ deck, progress, theme }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const c = { all: deck.length, hsk: 0, custom: 0 };
    deck.forEach(w => { if (w.source === "custom") c.custom++; else c.hsk++; });
    return c;
  }, [deck]);

  const list = useMemo(() => {
    let l = deck;
    if (filter === "hsk") l = l.filter(w => w.source !== "custom");
    else if (filter === "custom") l = l.filter(w => w.source === "custom");
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      l = l.filter(w => w.hanzi.includes(search.trim()) || w.pinyin.toLowerCase().includes(q) || w.meaning.toLowerCase().includes(q));
    }
    // Sort alphabetically by pinyin so classic and new HSK words interleave
    // rather than classic always appearing before new HSK.
    return [...l].sort((a, b) => a.pinyin.localeCompare(b.pinyin));
  }, [deck, filter, search]);

  const shown = list.slice(0, LIBRARY_CAP);

  return (
    <div>
      <FilterTabs theme={theme} value={filter} onChange={setFilter}
        tabs={[["all", "All", counts.all], ["hsk", "HSK", counts.hsk], ["custom", "Custom", counts.custom]]} />
      <SearchInput theme={theme} value={search} onChange={setSearch} />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.length === 0 && <EmptyState theme={theme} hanzi="无" title="Nothing here" description="No words match this filter or search." />}
        {shown.map(w => (
          <div key={w.id} style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 14 }}>
            <div className="hanzi" style={{ fontSize: 26, color: theme.text, minWidth: 52, lineHeight: 1 }}>{w.hanzi}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="display" style={{ fontSize: 14, color: theme.text, fontStyle: "italic" }}>
                <TonePinyin theme={theme} text={w.pinyin} />
                <span style={{ fontSize: 10, color: theme.textMute, marginLeft: 8, fontStyle: "normal", letterSpacing: "0.06em" }}>{w.source === "custom" ? "CUSTOM" : typeof w.level === "string" ? `New HSK ${w.level}` : `HSK ${w.level}`}</span>
              </div>
              <div style={{ fontSize: 13, color: theme.textMute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.meaning}</div>
            </div>
            <PlayButton theme={theme} tiny onClick={() => speak(w.hanzi)} />
            <LevelBadge theme={theme} level={levelOf(progress, w.id)} small />
          </div>
        ))}
        {list.length > LIBRARY_CAP && (
          <div style={{ textAlign: "center", fontSize: 12, color: theme.textMute, padding: "14px 0" }}>
            Showing {LIBRARY_CAP} of {list.length.toLocaleString()}. Search to narrow the list.
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  SETTINGS VIEW                                                      */
/* ================================================================== */
function SettingsView({ customWords, setCustomWords, progress, setProgress, darkMode, setDarkMode, streak, setStreak, todayCount, goal, setGoal, bestScores, setBestScores, theme }) {
  const blankForm = { hanzi: "", pinyin: "", meaning: "", partOfSpeech: "noun", exampleHanzi: "", examplePinyin: "", exampleEnglish: "" };
  const [form, setForm] = useState(blankForm);
  const [notice, setNotice] = useState("");
  const fileRef = useRef(null);
  const noticeTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(noticeTimerRef.current), []);
  const flash = (m) => {
    clearTimeout(noticeTimerRef.current);
    setNotice(m);
    noticeTimerRef.current = setTimeout(() => setNotice(""), 2500);
  };
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addWord = () => {
    if (!form.hanzi.trim() || !form.pinyin.trim() || !form.meaning.trim()) { flash("Hanzi, pinyin and meaning are required."); return; }
    const nums = customWords.map(w => Number(String(w.id).replace("custom-", ""))).filter(n => !isNaN(n));
    const maxId = nums.reduce((m, n) => Math.max(m, n), 0);
    const word = { ...form, id: `custom-${maxId + 1}`, source: "custom", level: "custom" };
    Object.keys(word).forEach(k => { if (typeof word[k] === "string") word[k] = word[k].trim(); });
    if (!word.exampleHanzi) { delete word.exampleHanzi; delete word.examplePinyin; delete word.exampleEnglish; }
    setCustomWords([...customWords, word]);
    setForm(blankForm);
    flash(`Added ${word.hanzi}.`);
  };
  const removeWord = (id) => {
    setCustomWords(customWords.filter(w => w.id !== id));
    setProgress(p => { const c = { ...p }; delete c[id]; return c; });
  };
  const exportData = () => {
    const payload = { version: 4, exportedAt: new Date().toISOString(), progress, customWords, streak, todayCount, goal, bestScores, settings: { darkMode } };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `hsk-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    flash("Exported your data.");
  };
  const importData = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => flash("That file could not be read.");
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data.progress && typeof data.progress === "object" && !Array.isArray(data.progress)) {
          setProgress(p => ({ ...p, ...data.progress }));
        }
        if (Array.isArray(data.customWords)) {
          const valid = data.customWords.filter(
            w => w && typeof w === "object" && w.id && w.hanzi && w.pinyin && w.meaning
          );
          setCustomWords(prev => {
            const ids = new Set(prev.map(w => w.id));
            return [...prev, ...valid.filter(w => !ids.has(w.id))];
          });
        }
        if (data.settings && typeof data.settings.darkMode === "boolean") setDarkMode(data.settings.darkMode);
        if (data.streak && typeof data.streak.count === "number") setStreak(data.streak);
        if (data.todayCount && typeof data.todayCount.count === "number") setTodayCount(data.todayCount);
        if (typeof data.goal === "number") setGoal(data.goal);
        if (data.bestScores && typeof data.bestScores === "object") setBestScores(data.bestScores);
        flash("Imported and merged your data.");
      } catch { flash("That file could not be read as valid JSON."); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };
  const resetProgress = () => {
    if (window.confirm("Reset all learning progress? Custom words are kept, but every card returns to New.")) { setProgress({}); flash("Progress reset."); }
  };

  const input = { width: "100%", padding: "10px 12px", background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 14, boxSizing: "border-box", outline: "none" };
  const section = { background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 20, marginBottom: 16 };
  const label = { fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: theme.textMute, marginBottom: 12, display: "block" };

  return (
    <div className="fade-in">
      {notice && <div style={{ position: "sticky", top: 8, zIndex: 5, background: theme.accent, color: "#fff", padding: "10px 16px", borderRadius: 10, fontSize: 13, marginBottom: 14, textAlign: "center" }}>{notice}</div>}

      <div style={section}>
        <span style={label}>Appearance</span>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, color: theme.text }}>Dark mode</span>
          <Button theme={theme} variant={darkMode ? "primary" : "ghost"} onClick={() => setDarkMode(d => !d)} style={{ padding: "8px 16px" }}>{darkMode ? "On" : "Off"}</Button>
        </div>
      </div>

      <div style={section}>
        <span style={label}>Learning</span>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 14, color: theme.text }}>Daily goal</span>
          <div style={{ display: "flex", gap: 6 }}>
            {[10, 20, 30, 50].map(n => (
              <Button key={n} theme={theme} variant={goal === n ? "primary" : "ghost"} onClick={() => setGoal(n)} style={{ padding: "6px 12px", fontSize: 13 }}>{n}</Button>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 12, color: theme.textMute, marginBottom: 14, fontVariantNumeric: "tabular-nums" }}>
          Today: {todayCount.count}/{goal} answered{todayCount.count >= goal ? " · goal met ✓" : ""}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 14, color: theme.text }}>Streak 🔥 {streak.count}</span>
          <Button theme={theme} variant="ghost" onClick={() => setStreak({ lastDate: "", count: 0 })} style={{ padding: "6px 12px", fontSize: 13 }}>Reset streak</Button>
        </div>
        {bestScores.best && (
          <div style={{ fontSize: 12, color: theme.textMute, fontVariantNumeric: "tabular-nums" }}>
            Best exam: <b style={{ color: bestScores.best.passed ? theme.good : theme.accent }}>{bestScores.best.score}</b>/{bestScores.best.maxScore} · {bestScores.best.passed ? "PASS" : "FAIL"} · {bestScores.best.date}
            <button onClick={() => setBestScores({})} style={{ background: "transparent", border: "none", color: theme.accent, fontSize: 12, cursor: "pointer", marginLeft: 10 }}>Reset best</button>
          </div>
        )}
      </div>

      <div style={section}>
        <span style={label}>Add your own word</span>
        <div style={{ display: "grid", gap: 10 }}>
          <div className="dual-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input style={input} placeholder="Hanzi 汉字" value={form.hanzi} onChange={e => setField("hanzi", e.target.value)} />
            <input style={input} placeholder="Pinyin" value={form.pinyin} onChange={e => setField("pinyin", e.target.value)} />
          </div>
          <input style={input} placeholder="English meaning" value={form.meaning} onChange={e => setField("meaning", e.target.value)} />
          <select style={input} value={form.partOfSpeech} onChange={e => setField("partOfSpeech", e.target.value)}>
            {PARTS_OF_SPEECH.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input style={input} placeholder="Example sentence (hanzi) — optional" value={form.exampleHanzi} onChange={e => setField("exampleHanzi", e.target.value)} />
          <input style={input} placeholder="Example pinyin — optional" value={form.examplePinyin} onChange={e => setField("examplePinyin", e.target.value)} />
          <input style={input} placeholder="Example translation — optional" value={form.exampleEnglish} onChange={e => setField("exampleEnglish", e.target.value)} />
          <Button theme={theme} variant="primary" onClick={addWord}>Add word</Button>
        </div>
        {customWords.length > 0 && (
          <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
            {customWords.map(w => (
              <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: theme.bg, border: `1px solid ${theme.border}`, borderRadius: 8 }}>
                <span className="hanzi" style={{ fontSize: 22, color: theme.text }}>{w.hanzi}</span>
                <span style={{ flex: 1, fontSize: 13, color: theme.textMute, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.pinyin} · {w.meaning}</span>
                <button onClick={() => removeWord(w.id)} style={{ background: "transparent", border: "none", color: theme.accent, fontSize: 13, cursor: "pointer", padding: 4 }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={section}>
        <span style={label}>Backup &amp; transfer</span>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Button theme={theme} variant="ghost" onClick={exportData}>Export JSON</Button>
          <Button theme={theme} variant="ghost" onClick={() => fileRef.current?.click()}>Import JSON</Button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={importData} style={{ display: "none" }} />
        <div style={{ fontSize: 12, color: theme.textMute, marginTop: 12, lineHeight: 1.5 }}>Export saves your progress and custom words to a file. Import merges a saved file back in — handy for moving between devices.</div>
      </div>

      <div style={section}>
        <span style={label}>Reset</span>
        <Button theme={theme} variant="ghost" onClick={resetProgress} style={{ width: "100%", color: theme.accent, borderColor: theme.accent }}>Reset all progress</Button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  EXAM VIEW — timed HSK-style mock test                             */
/*  Three sections: Listening (听力, audio), Reading (阅读, fill the   */
/*  blank from our example corpus), Vocabulary (词汇, word → meaning). */
/*  Each section is scored /100 → total /300, pass at 60%.             */
/*  Intentionally does NOT touch spaced-repetition progress.           */
/* ================================================================== */
const EXAM_TIMER_MS = 45 * 1000; // pacing per question
const EXAM_SIZES = [10, 20];
const EXAM_PASS_RATIO = 0.6;
const SECTIONS = [
  { id: "listening", label: "Listening", hanzi: "听力" },
  { id: "reading",   label: "Reading",   hanzi: "阅读" },
  { id: "vocab",     label: "Vocabulary", hanzi: "词汇" },
];
const SECT_META = Object.fromEntries(SECTIONS.map(s => [s.id, s]));

function fmtTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function readingUsable(card) {
  const ex = HSK_EXAMPLES[card.hanzi];
  return !!ex && ex.hanzi.includes(card.hanzi);
}

function buildQuestion(type, card, deck) {
  const options = buildQuizOptions(card, deck);
  if (type === "reading") {
    const ex = HSK_EXAMPLES[card.hanzi];
    return { type, card, options, sentence: ex.hanzi.replace(card.hanzi, "＿＿＿") };
  }
  return { type, card, options };
}

function ExamView({ deck, theme, bestScores, onFinish }) {
  const [phase, setPhase] = useState("config"); // config | exam | result
  const [size, setSize] = useState(10);
  const [activeSections, setActiveSections] = useState(SECTIONS.map(s => s.id));
  const [cur, setCur] = useState(0);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState([]);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [grade, setGrade] = useState(null);
  const [refFilter, setRefFilter] = useState("all");

  // Refs so the timer callback never reads a stale snapshot of answers.
  const liveRef = useRef({ questions: [], answers: [] });
  liveRef.current = { questions, answers };
  const endRef = useRef(0);

  const handleGrade = useCallback(() => {
    const { questions: qs, answers: an } = liveRef.current;
    if (qs.length === 0) return;
    const secCount = {}, secCorr = {};
    let correct = 0;
    qs.forEach((q, i) => {
      secCount[q.type] = (secCount[q.type] || 0) + 1;
      const right = an[i] === q.card.id;
      if (right) { secCorr[q.type] = (secCorr[q.type] || 0) + 1; correct++; }
    });
    const types = [...new Set(qs.map(q => q.type))];
    const sections = {};
    let score = 0, maxScore = 0;
    types.forEach(t => {
      const total = secCount[t] || 0, c = secCorr[t] || 0;
      const s = total ? Math.round(100 * c / total) : 0;
      sections[t] = { score: s, correct: c, total };
      score += s; maxScore += 100;
    });
    const passed = maxScore ? score >= maxScore * EXAM_PASS_RATIO : false;
    const result = { score, maxScore, passed, sections, answers: an, total: qs.length, correct };
    setGrade(result);
    if (onFinish) onFinish(result);
    setPhase("result");
  }, [onFinish]);

  useEffect(() => {
    if (phase !== "exam") return;
    const tick = () => {
      const left = Math.max(0, Math.round((endRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) handleGrade();
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [phase, handleGrade]);

  // Auto-play audio when a Listening question is shown.
  useEffect(() => {
    if (phase !== "exam") return;
    const q = questions[cur];
    if (q && q.type === "listening") speak(q.card.hanzi);
  }, [cur, phase, questions]);

  const start = () => {
    const qs = [];
    for (const sec of SECTIONS) {
      if (!activeSections.includes(sec.id)) continue;
      const src = sec.id === "reading" ? shuffleArray(deck.filter(readingUsable)) : shuffleArray([...deck]);
      const n = Math.min(size, src.length);
      for (let k = 0; k < n; k++) qs.push(buildQuestion(sec.id, src[k], deck));
    }
    if (qs.length === 0) return;
    setQuestions(qs);
    setAnswers(Array(qs.length).fill(null));
    setCur(0);
    setGrade(null);
    setRefFilter("all");
    endRef.current = Date.now() + qs.length * EXAM_TIMER_MS;
    setSecondsLeft(Math.floor(qs.length * EXAM_TIMER_MS / 1000));
    setPhase("exam");
  };

  const choose = (i, optId) => setAnswers(prev => {
    const c = [...prev];
    c[i] = optId;
    return c;
  });

  const toggleSection = (id) => setActiveSections(prev =>
    prev.includes(id) ? (prev.length > 1 ? prev.filter(x => x !== id) : prev) : [...prev, id]
  );

  /* ---------- config ---------- */
  if (phase === "config") {
    const totalQ = activeSections.length * size;
    return (
      <div className="fade-in">
        <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 28, textAlign: "center", marginBottom: 16 }}>
          <div className="hanzi" style={{ fontSize: 40, color: theme.accent, marginBottom: 8 }}>试</div>
          <div className="display" style={{ fontSize: 20, fontWeight: 600, color: theme.text }}>HSK Mock Exam</div>
          <div style={{ fontSize: 13, color: theme.textMute, marginTop: 8, lineHeight: 1.5 }}>
            Listening · Reading · Vocabulary. Each section out of 100 → total /300; pass at 60%.
          </div>
          <div style={{ fontSize: 12, color: theme.textMute, marginTop: 12, fontVariantNumeric: "tabular-nums" }}>
            {deck.length.toLocaleString()} words in the active deck
          </div>
          {bestScores.best && (
            <div style={{ fontSize: 12, color: theme.textMute, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
              Best exam: <b style={{ color: bestScores.best.passed ? theme.good : theme.accent }}>{bestScores.best.score}</b>/{bestScores.best.maxScore} · {bestScores.best.passed ? "PASS 合格" : "FAIL"} · {bestScores.best.date}
            </div>
          )}
        </div>

        {deck.length < 4 ? (
          <EmptyState theme={theme} hanzi="题" title="Need at least 4 words"
            description="The exam builds questions from the active deck. Turn on an HSK level above or add custom words." />
        ) : (
          <>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: theme.textMute, marginBottom: 10 }}>Sections</div>
            <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
              {SECTIONS.map(sec => {
                const on = activeSections.includes(sec.id);
                const cantRead = sec.id === "reading" && deck.filter(readingUsable).length < 4;
                return (
                  <Button key={sec.id} theme={theme} variant={on ? "primary" : "ghost"} onClick={() => toggleSection(sec.id)}
                    style={{ justifyContent: "space-between", opacity: cantRead ? 0.55 : 1 }}>
                    <span>{sec.label}</span>
                    <span className="hanzi" style={{ fontSize: 16 }}>{sec.hanzi}</span>
                  </Button>
                );
              })}
            </div>

            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: theme.textMute, marginBottom: 10 }}>Questions per section</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              {EXAM_SIZES.map(n => {
                const active = size === n;
                return (
                  <Button key={n} theme={theme} variant={active ? "primary" : "ghost"} onClick={() => setSize(n)}>
                    {n}
                  </Button>
                );
              })}
            </div>

            <div style={{ fontSize: 12, color: theme.textMute, marginBottom: 18 }}>
              {totalQ} questions · about {Math.ceil(totalQ * EXAM_TIMER_MS / 60000)} min
            </div>

            <Button theme={theme} variant="primary" onClick={start} style={{ width: "100%" }}>Start exam</Button>
            <div style={{ fontSize: 11, color: theme.textMute, textAlign: "center", marginTop: 12, lineHeight: 1.5 }}>
              Your answers here won't affect your spaced-repetition progress.
            </div>
          </>
        )}
      </div>
    );
  }

  /* ---------- result ---------- */
  if (phase === "result" && grade) {
    const wrong = grade.answers.filter((a, i) => a !== questions[i].card.id).length;
    const shown = refFilter === "all" ? questions : questions.filter((_, i) => grade.answers[i] !== questions[i].card.id);
    return (
      <div className="fade-in">
        <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 28, textAlign: "center", marginBottom: 16 }}>
          {grade.passed && <Confetti />}
          <div className="display" style={{ fontSize: 52, fontWeight: 600, color: theme.text, lineHeight: 1 }}>
            {grade.score}<span style={{ fontSize: 18, color: theme.textMute }}> / {grade.maxScore}</span>
          </div>
          <div style={{ marginTop: 12, display: "inline-block", padding: "6px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, letterSpacing: "0.04em",
            background: grade.passed ? `${theme.good}1A` : `${theme.accent}1A`, color: grade.passed ? theme.good : theme.accent }}>
            {grade.passed ? "PASS · 合格" : "FAIL · 不合格"}
          </div>
          <div style={{ fontSize: 13, color: theme.textMute, marginTop: 12, fontVariantNumeric: "tabular-nums" }}>
            {grade.correct} / {grade.total} correct · {Math.round(100 * grade.correct / grade.total)}%
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 14 }}>
            {SECTIONS.filter(s => grade.sections[s.id]).map(s => {
              const g = grade.sections[s.id];
              const op = (g.correct * 100 / g.total);
              return (
                <span key={s.id} style={{ padding: "5px 12px", borderRadius: 999, fontSize: 12, background: theme.surfaceAlt, color: theme.text, border: `1px solid ${theme.border}` }}>
                  <span className="hanzi">{s.hanzi}</span> <b>{g.score}</b>/100 · {op >= 60 ? "✓" : "✗"}
                </span>
              );
            })}
          </div>
        </div>

        <FilterTabs theme={theme} value={refFilter} onChange={setRefFilter}
          tabs={[["all", "All", grade.total], ["wrong", "Mistakes", wrong]]} />

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {shown.map((q, idx) => {
            const i = questions.indexOf(q);
            const chose = grade.answers[i];
            const isRight = chose === q.card.id;
            const choseOpt = chose != null ? q.options.find(o => o.id === chose) : null;
            const fullSentence = q.type === "reading" ? HSK_EXAMPLES[q.card.hanzi]?.hanzi : null;
            return (
              <div key={q.card.id} style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: theme.textMute, minWidth: 16 }}>{SECT_META[q.type].hanzi}</span>
                  <span style={{ fontSize: 12, color: theme.textMute, fontVariantNumeric: "tabular-nums", minWidth: 24 }}>{i + 1}.</span>
                  <span className="hanzi" style={{ fontSize: 20, color: theme.text }}>{q.card.hanzi}</span>
                  <PlayButton theme={theme} tiny onClick={() => speak(q.card.hanzi)} />
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 16 }}>{isRight ? "✓" : "✗"}</span>
                </div>
                <div className="display" style={{ fontSize: 13, color: theme.textMute, fontStyle: "italic", marginBottom: 6 }}>{q.card.pinyin}</div>
                {fullSentence && <div className="hanzi" style={{ fontSize: 15, color: theme.textMute, lineHeight: 1.6, marginBottom: 6 }}>{fullSentence}</div>}
                {isRight
                  ? <div style={{ fontSize: 13, color: theme.text }}>you answered correctly · {primaryMeaning(q.card.meaning)}</div>
                  : <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                      <span style={{ color: theme.accent }}>You: {choseOpt ? (q.type === "reading" ? choseOpt.hanzi : primaryMeaning(choseOpt.meaning)) : "no answer"}</span>
                      <span style={{ color: theme.textMute }}>{"  ·  "}Correct: {q.type === "reading" ? q.card.hanzi : primaryMeaning(q.card.meaning)}</span>
                    </div>}
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Button theme={theme} variant="ghost" onClick={() => setPhase("config")}>Retake</Button>
          <Button theme={theme} variant="primary" onClick={start}>New exam →</Button>
        </div>
      </div>
    );
  }

  /* ---------- in-progress ---------- */
  const q = questions[cur];
  const unanswered = answers.filter(a => a == null).length;
  const sec = SECT_META[q.type];
  return (
    <div className="fade-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: theme.textMute, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          <span className="hanzi" style={{ marginRight: 6 }}>{sec.hanzi}</span>
          Question {cur + 1} / {questions.length}
        </span>
        <span style={{ fontSize: 14, color: secondsLeft <= 60 ? theme.accent : theme.text, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          ⏱ {fmtTime(secondsLeft)}
        </span>
      </div>

      <div style={{ background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 12, padding: "30px 20px", textAlign: "center", marginBottom: 12 }}>
        {q.type === "listening" && (
          <>
            <PlayButton theme={theme} onClick={() => speak(q.card.hanzi)} />
            <div style={{ fontSize: 13, color: theme.textMute, marginTop: 14, lineHeight: 1.5 }}>
              Listen to the word, then choose its meaning.
            </div>
          </>
        )}
        {q.type === "reading" && (
          <>
            <div className="hanzi" style={{ fontSize: "clamp(19px,5.4vw,26px)", lineHeight: 1.7, color: theme.text }}>{q.sentence}</div>
            <div style={{ fontSize: 12, color: theme.textMute, marginTop: 12 }}>Choose the word that best completes the sentence.</div>
          </>
        )}
        {q.type === "vocab" && (
          <>
            <div className="hanzi" style={{ fontSize: 26, color: theme.text }}>{q.card.hanzi}</div>
            <div className="display" style={{ fontSize: 14, fontStyle: "italic", marginTop: 8 }}><TonePinyin theme={theme} text={q.card.pinyin} /></div>
            <div style={{ fontSize: 12, color: theme.textMute, marginTop: 12 }}>Choose the meaning.</div>
          </>
        )}
      </div>

      <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        {q.options.map(opt => {
          const sel = answers[cur] === opt.id;
          return (
            <Button key={opt.id} theme={theme} variant={sel ? "primary" : "ghost"} onClick={() => choose(cur, opt.id)}
              style={{ textAlign: "left", justifyContent: "flex-start", cursor: "pointer" }}>
              {q.type === "reading" ? <span className="hanzi" style={{ fontSize: 19 }}>{opt.hanzi}</span> : primaryMeaning(opt.meaning)}
            </Button>
          );
        })}
      </div>

      {SECTIONS.filter(s => activeSections.includes(s.id) && questions.some((qq, i) => qq.type === s.id && i < questions.length)).map(secRow => {
        const idxs = questions.map((qq, i) => qq.type === secRow.id ? i : -1).filter(i => i >= 0);
        return (
          <div key={secRow.id} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: theme.textMute, marginBottom: 6 }}>
              <span className="hanzi">{secRow.hanzi}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {idxs.map(i => {
                const answered = answers[i] != null;
                const active = i === cur;
                return (
                  <button key={i} onClick={() => setCur(i)}
                    style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${answered ? theme.accent : theme.border}`,
                      background: active ? theme.accent : (answered ? `${theme.accent}22` : theme.surface),
                      color: active ? "#fff" : (answered ? theme.accent : theme.textMute),
                      fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <div style={{ fontSize: 11, color: theme.textMute, textAlign: "center", marginTop: 4, marginBottom: 14 }}>
        {unanswered > 0 ? `${unanswered} unanswered` : "All answered"}
      </div>

      <div className="dual-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <Button theme={theme} variant="subtle" disabled={cur === 0} onClick={() => setCur(i => i - 1)}>← Previous</Button>
        {cur === questions.length - 1
          ? <Button theme={theme} variant="primary" onClick={handleGrade}>Submit exam</Button>
          : <Button theme={theme} variant="subtle" onClick={() => setCur(i => i + 1)}>Next →</Button>}
      </div>
      <Button theme={theme} variant="subtle" onClick={handleGrade} style={{ width: "100%" }}>
        Submit exam{unanswered > 0 ? ` (${unanswered} unanswered)` : ""}
      </Button>
    </div>
  );
}

/* ================================================================== */
/*  MAIN APP                                                           */
/* ================================================================== */
const TABS = [["study", "Study"], ["quiz", "Quiz"], ["review", "Review"], ["exam", "Exam"], ["library", "Library"], ["settings", "Settings"]];

export default function App() {
  const [progress, setProgress]       = usePersistedState("hsk-progress", {});
  const [customWords, setCustomWords] = usePersistedState("hsk-custom", []);
  const [darkMode, setDarkMode]       = usePersistedState("hsk-dark", false);
  const [reverseMode, setReverseMode] = usePersistedState("hsk-reverse", false);
  const [levels, setLevels]           = usePersistedState("hsk-levels", [3]); // HSK 3 by default
  const [view, setView]               = useState("study");

  // Motivation tracking (per device, no login): streak, today's count vs goal,
  // and best exam score.
  const [streak, setStreak]           = usePersistedState("hsk-streak", { lastDate: "", count: 0 });
  const [todayCount, setTodayCount]   = usePersistedState("hsk-today", { date: todayStr(), count: 0 });
  const [goal, setGoal]               = usePersistedState("hsk-goal", 20);
  const [bestScores, setBestScores]   = usePersistedState("hsk-best-scores", {});

  // Reset today's counter when the calendar day rolls over.
  useEffect(() => {
    if (todayCount.date !== todayStr()) setTodayCount({ date: todayStr(), count: 0 });
  }, [todayCount, setTodayCount]);

  const trackActivity = useCallback(() => {
    const today = todayStr();
    setStreak(prev => {
      let count = prev.count;
      if (prev.lastDate !== today) count = (prev.lastDate === yesterdayStr()) ? prev.count + 1 : 1;
      return { lastDate: today, count };
    });
    setTodayCount(prev => ({ date: today, count: (prev.date === today ? prev.count : 0) + 1 }));
  }, [setStreak, setTodayCount]);

  const theme = getTheme(darkMode);

  // Active deck = selected HSK levels + all custom words.
  const deck = useMemo(() => {
    const levelSet = new Set(levels);
    const hsk = HSK_WORDS.filter(w => levelSet.has(w.level)).map(w => ({ ...w, source: "hsk" }));
    return [...hsk, ...customWords];
  }, [levels, customWords]);

  const onAnswer = useCallback((cardId, correct) => {
    trackActivity();
    setProgress(prev => ({ ...prev, [cardId]: applyAnswer(prev[cardId], correct) }));
  }, [trackActivity, setProgress]);

  const handleExamFinish = useCallback((grade) => {
    if (!grade) return;
    trackActivity();
    setBestScores(prev => {
      const best = prev.best;
      if (!best || grade.score > best.score) {
        return { ...prev, best: { score: grade.score, maxScore: grade.maxScore, passed: grade.passed, date: todayStr() } };
      }
      return prev;
    });
  }, [trackActivity, setBestScores]);

  const stats = useMemo(() => {
    const total = deck.length;
    let known = 0, learning = 0;
    deck.forEach(c => { const l = levelOf(progress, c.id); if (l === 3) known++; else if (l >= 1) learning++; });
    return { total, known, learning, pct: total ? Math.round((known / total) * 100) : 0 };
  }, [deck, progress]);

  // Mastered count per HSK level, for the per-level progress on the deck bar.
  const levelStats = useMemo(() => {
    const m = {};
    deck.forEach(c => {
      const k = c.level;
      if (!m[k]) m[k] = { total: 0, mastered: 0 };
      m[k].total++;
      if (levelOf(progress, c.id) === 3) m[k].mastered++;
    });
    return m;
  }, [deck, progress]);

  const dueCount = useMemo(() => deck.reduce((n, c) => n + (isDue(progress, c.id) ? 1 : 0), 0), [deck, progress]);

  // Show a live streak only if studied today or yesterday (else it's broken).
  const displayStreak = (streak.lastDate === todayStr() || streak.lastDate === yesterdayStr()) ? streak.count : 0;
  const goalPct = goal > 0 ? Math.min(100, Math.round((todayCount.count / goal) * 100)) : 0;

  return (
    <div style={{ minHeight: "100vh", background: theme.bg, color: theme.text, fontFamily: '"IBM Plex Sans", system-ui, sans-serif', transition: "background 0.3s, color 0.3s" }}>
      <FontLoader />
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes confetti-fall { from { transform: translateY(0) rotate(0deg); opacity: 1; } to { transform: translateY(64px) rotate(360deg); opacity: 0; } }
        .fade-in { animation: fadeIn 0.3s ease-out; }
        .hanzi   { font-family: "Noto Serif SC", "Source Han Serif SC", serif; }
        .display { font-family: "Fraunces", Georgia, serif; }
        .card-flip { transform-style: preserve-3d; transition: transform 0.5s cubic-bezier(0.4,0,0.2,1); }
        .card-flip.flipped { transform: rotateY(180deg); }
        .card-face { backface-visibility: hidden; -webkit-backface-visibility: hidden; }
        .card-back { transform: rotateY(180deg); }
        button { font-family: inherit; }
        input, select { font-family: inherit; }
        .btn-primary:hover:not(:disabled) { opacity: 0.92; }
        .btn-ghost:hover:not(:disabled) { background: ${theme.surfaceAlt}; }
        .quiz-option:hover:not(:disabled) { border-color: ${theme.accent}; }
        ::selection { background: ${theme.accent}; color: ${theme.surface}; }
        * { -webkit-tap-highlight-color: transparent; }
        @media (max-width: 430px) { .dual-grid { grid-template-columns: 1fr !important; } }
      `}</style>

      <header style={{ borderBottom: `1px solid ${theme.border}`, position: "sticky", top: 0, background: theme.bg, zIndex: 20 }}>
        <div style={{ maxWidth: 640, margin: "0 auto", padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div className="display" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em" }}>HSK <span className="hanzi" style={{ color: theme.accent }}>汉语</span></div>
            <div style={{ fontSize: 10, color: theme.textMute, letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 2 }}>
              {stats.known.toLocaleString()} mastered · {stats.pct}% · 🔥 {displayStreak}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => setReverseMode(r => !r)} className="btn-ghost" title="Show English first; recall the hanzi"
              style={{ background: reverseMode ? theme.accent : "transparent", color: reverseMode ? "#fff" : theme.textMute, border: `1px solid ${reverseMode ? theme.accent : theme.border}`, padding: "6px 12px", borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: "pointer" }}>Reverse</button>
            <button onClick={() => setDarkMode(d => !d)} className="btn-ghost" aria-label="Toggle dark mode"
              style={{ background: "transparent", color: theme.text, border: `1px solid ${theme.border}`, width: 34, height: 34, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, cursor: "pointer" }}>{darkMode ? "☀" : "☾"}</button>
          </div>
        </div>
        <div style={{ height: 2, background: theme.border }}>
          <div style={{ height: "100%", width: `${stats.pct}%`, background: theme.accent, transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)" }} />
        </div>
        <div style={{ height: 2, background: theme.border, marginTop: 1 }}>
          <div style={{ height: "100%", width: `${goalPct}%`, background: theme.good, transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)" }} title={`${todayCount.count}/${goal} today`} />
        </div>
      </header>

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "22px 20px 110px" }}>
        <DeckBar theme={theme} levels={levels} setLevels={setLevels} deckSize={deck.length} levelStats={levelStats} />
        {view === "study"    && <StudyView   deck={deck} progress={progress} onAnswer={onAnswer} reverseMode={reverseMode} theme={theme} />}
        {view === "quiz"     && <QuizView    deck={deck} progress={progress} onAnswer={onAnswer} reverseMode={reverseMode} theme={theme} />}
        {view === "review"   && <ReviewView  deck={deck} progress={progress} onAnswer={onAnswer} reverseMode={reverseMode} theme={theme} />}
        {view === "exam"     && <ExamView    deck={deck} theme={theme} bestScores={bestScores} onFinish={handleExamFinish} />}
        {view === "library"  && <LibraryView deck={deck} progress={progress} theme={theme} />}
        {view === "settings" && <SettingsView customWords={customWords} setCustomWords={setCustomWords} progress={progress} setProgress={setProgress} darkMode={darkMode} setDarkMode={setDarkMode}
            streak={streak} setStreak={setStreak} todayCount={todayCount} goal={goal} setGoal={setGoal} bestScores={bestScores} setBestScores={setBestScores} theme={theme} />}
      </main>

      <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: theme.surface, borderTop: `1px solid ${theme.border}`, zIndex: 30, paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex" }}>
          {TABS.map(([key, label]) => {
            const active = view === key;
            return (
              <button key={key} onClick={() => setView(key)} style={{ flex: 1, position: "relative", padding: "12px 4px 14px", background: "transparent", border: "none", cursor: "pointer", color: active ? theme.text : theme.textMute, fontSize: 12, fontWeight: 500 }}>
                {active && <span style={{ position: "absolute", top: 0, left: "28%", right: "28%", height: 2, background: theme.accent, borderRadius: "0 0 3px 3px" }} />}
                {label}
                {key === "review" && dueCount > 0 && (
                  <span style={{ position: "absolute", top: 6, right: "20%", minWidth: 16, height: 16, padding: "0 4px", borderRadius: 999, background: theme.accent, color: "#fff", fontSize: 10, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>{dueCount > 99 ? "99+" : dueCount}</span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
