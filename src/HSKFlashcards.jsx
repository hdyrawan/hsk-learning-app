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
  return { hanzi: ex.hanzi, pinyin: "", english: ex.english };
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
      {ex.pinyin && <div className="display" style={{ fontSize: 15, color: theme.textMute, fontStyle: "italic", lineHeight: 1.5, marginBottom: 6 }}>{ex.pinyin}</div>}
      {ex.english && <div style={{ fontSize: 14, color: theme.textMute, lineHeight: 1.5 }}>{ex.english}</div>}
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

function DeckBar({ theme, levels, setLevels, deckSize }) {
  const toggle = (lvl) => {
    setLevels(prev => {
      if (prev.includes(lvl)) return prev.length > 1 ? prev.filter(l => l !== lvl) : prev;
      return [...prev, lvl].sort((a, b) => (LEVEL_ORDER[a] ?? 99) - (LEVEL_ORDER[b] ?? 99));
    });
  };

  const row = (rowLevels, label) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
      <span style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: theme.textMute, minWidth: 52, flexShrink: 0 }}>{label}</span>
      {rowLevels.map(lvl => {
        const on = levels.includes(lvl);
        const label = typeof lvl === "string" ? lvl.slice(1) : lvl;
        return (
          <button key={lvl} onClick={() => toggle(lvl)} className="btn-ghost"
            style={{ width: 30, height: 30, borderRadius: 999, border: `1px solid ${on ? theme.accent : theme.border}`, background: on ? theme.accent : "transparent", color: on ? "#fff" : theme.textMute, fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
            {label}
          </button>
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
  const grade = useCallback((correct) => { if (!card) return; onAnswer(card.id, correct); next(); }, [card, onAnswer, next]);
  const shuffle = () => { setOrder(shuffleArray(order)); setIndex(0); setFlipped(false); };

  useEffect(() => {
    const handler = (e) => {
      if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === " ") { e.preventDefault(); setFlipped(f => !f); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "k" || e.key === "K") { e.preventDefault(); grade(true); }
      else if (e.key === "l" || e.key === "L") { e.preventDefault(); grade(false); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [next, grade]);

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
            <div className="card-face card-back" style={{ ...cardFaceStyle(theme), justifyContent: "flex-start", overflow: "auto" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span className="hanzi" style={{ fontSize: 38, fontWeight: 500, color: theme.text, lineHeight: 1 }}>{card.hanzi}</span>
                  <PlayButton theme={theme} onClick={(e) => { e.stopPropagation(); speak(card.hanzi); }} />
                </div>
                <span className="display" style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: theme.accent, fontStyle: "italic", whiteSpace: "nowrap" }}>{card.partOfSpeech}</span>
              </div>
              <div className="display" style={{ fontSize: 22, color: theme.text, fontStyle: "italic", marginBottom: 6 }}>{card.pinyin}</div>
              <div style={{ fontSize: 17, color: theme.text, lineHeight: 1.45, marginBottom: exampleFor(card) ? 20 : 0 }}>{card.meaning}</div>
              <ExampleBlock theme={theme} card={card} />
            </div>
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
        <Button theme={theme} variant="subtle" disabled={!card} onClick={next}>Next →</Button>
        <Button theme={theme} variant="subtle" onClick={shuffle}>Shuffle</Button>
      </div>
      <div style={{ fontSize: 11, color: theme.textMute, textAlign: "center", padding: "18px 0 0" }}>
        <Kbd theme={theme}>Space</Kbd> flip <span style={{ margin: "0 8px", opacity: 0.4 }}>·</span>
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

  const prompt = reverseMode ? card.meaning : card.hanzi;
  const labelOf = (opt) => reverseMode ? opt.hanzi : opt.meaning;

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
      <EmptyState theme={theme} hanzi="成" title="Session complete" description={`You reviewed ${done} ${done === 1 ? "card" : "cards"}. Nicely done.`}>
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
          <div className="card-face card-back" style={{ ...cardFaceStyle(theme), justifyContent: "center", textAlign: "center", overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 8 }}>
              <span className="hanzi" style={{ fontSize: 34, color: theme.text }}>{card.hanzi}</span>
              <PlayButton theme={theme} onClick={(e) => { e.stopPropagation(); speak(card.hanzi); }} />
            </div>
            <div className="display" style={{ fontSize: 20, color: theme.text, fontStyle: "italic", marginBottom: 4 }}>{card.pinyin}</div>
            <div style={{ fontSize: 16, color: theme.text }}>{card.meaning}</div>
            {(() => { const ex = exampleFor(card); return ex && <>
              <div className="hanzi" style={{ fontSize: 17, color: theme.textMute, lineHeight: 1.6, marginTop: 14 }}>{ex.hanzi}</div>
              {ex.english && <div style={{ fontSize: 13, color: theme.textMute, marginTop: 4 }}>{ex.english}</div>}
            </>; })()}
          </div>
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
                {w.pinyin}
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
function SettingsView({ customWords, setCustomWords, progress, setProgress, darkMode, setDarkMode, theme }) {
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
    const payload = { version: 3, exportedAt: new Date().toISOString(), progress, customWords, settings: { darkMode } };
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
/*  MAIN APP                                                           */
/* ================================================================== */
const TABS = [["study", "Study"], ["quiz", "Quiz"], ["review", "Today"], ["library", "Library"], ["settings", "Settings"]];

export default function App() {
  const [progress, setProgress]       = usePersistedState("hsk-progress", {});
  const [customWords, setCustomWords] = usePersistedState("hsk-custom", []);
  const [darkMode, setDarkMode]       = usePersistedState("hsk-dark", false);
  const [reverseMode, setReverseMode] = usePersistedState("hsk-reverse", false);
  const [levels, setLevels]           = usePersistedState("hsk-levels", [3]); // HSK 3 by default
  const [view, setView]               = useState("study");

  const theme = getTheme(darkMode);

  // Active deck = selected HSK levels + all custom words.
  const deck = useMemo(() => {
    const levelSet = new Set(levels);
    const hsk = HSK_WORDS.filter(w => levelSet.has(w.level)).map(w => ({ ...w, source: "hsk" }));
    return [...hsk, ...customWords];
  }, [levels, customWords]);

  const onAnswer = useCallback((cardId, correct) => {
    setProgress(prev => ({ ...prev, [cardId]: applyAnswer(prev[cardId], correct) }));
  }, [setProgress]);

  const stats = useMemo(() => {
    const total = deck.length;
    let known = 0, learning = 0;
    deck.forEach(c => { const l = levelOf(progress, c.id); if (l === 3) known++; else if (l >= 1) learning++; });
    return { total, known, learning, pct: total ? Math.round((known / total) * 100) : 0 };
  }, [deck, progress]);

  const dueCount = useMemo(() => deck.reduce((n, c) => n + (isDue(progress, c.id) ? 1 : 0), 0), [deck, progress]);

  return (
    <div style={{ minHeight: "100vh", background: theme.bg, color: theme.text, fontFamily: '"IBM Plex Sans", system-ui, sans-serif', transition: "background 0.3s, color 0.3s" }}>
      <FontLoader />
      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
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
            <div style={{ fontSize: 10, color: theme.textMute, letterSpacing: "0.12em", textTransform: "uppercase", marginTop: 2 }}>{stats.known.toLocaleString()} mastered · {stats.pct}%</div>
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
      </header>

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "22px 20px 110px" }}>
        <DeckBar theme={theme} levels={levels} setLevels={setLevels} deckSize={deck.length} />
        {view === "study"    && <StudyView   deck={deck} progress={progress} onAnswer={onAnswer} reverseMode={reverseMode} theme={theme} />}
        {view === "quiz"     && <QuizView    deck={deck} progress={progress} onAnswer={onAnswer} reverseMode={reverseMode} theme={theme} />}
        {view === "review"   && <ReviewView  deck={deck} progress={progress} onAnswer={onAnswer} reverseMode={reverseMode} theme={theme} />}
        {view === "library"  && <LibraryView deck={deck} progress={progress} theme={theme} />}
        {view === "settings" && <SettingsView customWords={customWords} setCustomWords={setCustomWords} progress={progress} setProgress={setProgress} darkMode={darkMode} setDarkMode={setDarkMode} theme={theme} />}
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
