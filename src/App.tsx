import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Icon } from "./icons";
import { ParticleBall } from "./ParticleBall";
import { useRewardedAd } from "./useRewardedAd";
import {
  categories, compare, dayKey, DEMO_DATA, MAX_REWARDED_ADS, MAX_TOTAL_ATTEMPTS,
  playerMap, players, reducer, RELEASE_READY, restore, shareText, searchPlayers, SNAPSHOT_DATE,
} from "./game";
import type { Clue, GameState, Player } from "./game";

const STORAGE_KEY = "who-am-i-kbo:daily:v1";
const THEME_KEY = "who-am-i-kbo:theme";
type ModalType = "help" | "stats" | "collection" | "share" | null;
const exchangePolicies = Array.from(new Map(players
  .filter((player) => player.salaryCurrency !== "KRW")
  .map((player) => [player.salaryCurrency + ":" + player.fxRate + ":" + player.fxDate, player])).values());

function BaseballMark() {
  return <svg viewBox="0 0 32 32" width="24" height="24" fill="none" aria-hidden="true">
    <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 5c8 6 8 16 0 22M24 5c-8 6-8 16 0 22M10 9l-3 1m5 3-3 1m3 4-3-1m1 6-3-1m15-13 3 1m-5 3 3 1m-3 4 3-1m-1 6 3-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}
function PlayerAvatar({ player }: { player: Player }) {
  return <span className="avatar" style={{ "--kit-color": "var(--accent)" } as React.CSSProperties}>
    <svg viewBox="0 0 240 240" fill="none" aria-hidden="true">
      <path d="m78 43-47 28 20 44 25-12v92c34 12 54 12 88 0v-92l25 12 20-44-47-28-23-7-19 20-19-20Z" fill="currentColor" fillOpacity=".09" stroke="currentColor" strokeWidth="2" />
      <path d="m101 36 19 20 19-20m-19 20v139M77 103l2-31m84 31-2-31M82 182q38 13 76 0" stroke="currentColor" strokeOpacity=".5" strokeWidth="2" />
      <circle cx="120" cy="75" r="2" fill="currentColor" /><circle cx="120" cy="96" r="2" fill="currentColor" />
      <text x="151" y="155" textAnchor="middle" fill="currentColor" fontSize={player.number.length > 2 ? 43 : 55} fontWeight="700" fontFamily="system-ui,sans-serif">{player.number}</text>
    </svg>
  </span>;
}
function Tile({ clue }: { clue: Clue }) {
  const state = clue.match === "exact" ? "일치" : "불일치";
  const direction = clue.direction ? (clue.direction === "up" ? ", 정답이 더 높음" : ", 정답이 더 낮음") : "";
  return <div className={"clue " + clue.match + (clue.key === "salaryKRW" ? " clue-salary" : "")}
    title={clue.label + ": " + clue.value + " · " + state + direction}
    aria-label={clue.label + " " + clue.value + ", " + state + direction}>
    <span className="clue-content"><strong>{clue.key === "salaryKRW" ? clue.value.replace(/ 원$/, "원") : clue.value}</strong>
      {clue.direction && <Icon name="arrow" className={clue.direction === "down" ? "down" : ""} />}
      {clue.match === "exact" && <Icon name="check" className="tile-check" />}
    </span>
    <span className="clue-label">{clue.label}</span>
  </div>;
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const d = dialog.current!;
    d.showModal();
    return () => {
      if (d.open) d.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="닫기" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Search({
  guesses,
  onGuess,
}: {
  guesses: string[];
  onGuess: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [focused, setFocused] = useState(false),
    [highlight, setHighlight] = useState(0);
  const results = searchPlayers(query, guesses),
    listId = useId(),
    input = useRef<HTMLInputElement>(null);
  const open = focused && query.trim().length > 0;
  const pick = (p: Player) => {
    onGuess(p.id);
    setQuery("");
    setHighlight(0);
    input.current?.focus();
  };
  return (
    <div className="search-wrap">
      <div className={`search-input ${focused ? "focused" : ""}`}>
        <Icon name="search" width="23" height="23" />
        <input
          ref={input}
          role="combobox"
          aria-label="선수 이름 검색"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-activedescendant={
            open && results[highlight] ? `${listId}-${highlight}` : undefined
          }
          autoComplete="off"
          placeholder={
            guesses.length
              ? "다음으로 떠오르는 선수는?"
              : "선수 이름을 입력하세요"
          }
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            if (
              !e.currentTarget.parentElement?.parentElement?.contains(
                e.relatedTarget,
              )
            )
              setFocused(false);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setFocused(true);
              setHighlight((i) => Math.max(0, Math.min(i + 1, results.length - 1)));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && open && results[highlight]) {
              e.preventDefault();
              pick(results[highlight]);
            }
            if (e.key === "Escape") setFocused(false);
          }}
        />
        {query ? (
          <button
            className="icon-button clear-search"
            aria-label="검색어 지우기"
            onClick={() => {
              setQuery("");
              input.current?.focus();
            }}
          >
            <Icon name="close" />
          </button>
        ) : (
          <span className="search-key" aria-hidden="true">
            검색
          </span>
        )}
      </div>
      {open && (
        <div
          className="search-results"
          id={listId}
          role="listbox"
          aria-label="검색 결과"
        >
          {results.length ? (
            <>
              <div className="result-hint">선택하면 추측이 제출돼요</div>
              {results.map((p, i) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  id={`${listId}-${i}`}
                  key={p.id}
                  className={`search-result ${i === highlight ? "highlight" : ""}`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(p)}
                >
                  <PlayerAvatar player={p} />
                  <span className="result-name">
                    <strong>{p.name}</strong>
                    <span>{p.latinSource !== "romanized" ? p.latin + " · " : ""}{p.club} · {p.number}</span>
                  </span>
                  <Icon name="chevron" />
                </button>
              ))}
            </>
          ) : (
            <div className="empty-result">
              <strong>검색 결과가 없어요</strong>
              <p>
                한글·영문 이름이나 초성으로 다시 검색해 보세요.
                <br />
                이미 추측한 선수는 목록에 표시되지 않아요.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HelpContent() {
  return <>
    <p className="modal-intro">기본 5번 안에 오늘의 야구 선수를 맞혀보세요. 기회를 모두 쓰면 광고를 완료할 때마다 1번 더, 한 문제에서 최대 3번 도전할 수 있어요.</p>
    <ol className="help-steps">
      <li><span>01</span><div><strong>선수 이름을 검색하세요</strong><p>한국어, 영문 검색명, 초성을 지원해요. 목록에서 선수를 선택하면 한 번의 기회를 사용해요.</p></div></li>
      <li><span>02</span><div><strong>6가지 단서를 확인하세요</strong><p>{categories.join("·")}를 비교해요. 보라는 정확히 일치, 분홍은 불일치예요.</p>
        <div className="legend"><span><i className="match-dot" />일치</span><span><i className="miss-dot" />불일치</span></div>
      </div></li>
      <li><span>03</span><div><strong>정답을 좁혀보세요</strong><p>출생연도·등번호·키·연봉의 화살표는 정답의 값이 더 높은지, 낮은지 알려줘요.</p></div></li>
    </ol>
    <div className="example-grid">
      <Tile clue={{ key: "club", label: "구단", value: "LG", match: "exact" }} />
      <Tile clue={{ key: "heightCm", label: "키", value: "180cm", match: "miss", direction: "up" }} />
      <Tile clue={{ key: "salaryKRW", label: "연봉", value: "5억 원", match: "miss", direction: "down" }} />
    </div>
    <p className="example-caption">등번호 0과 00은 서로 달라요. 숫자값만 같으면 불일치로 표시하고 화살표는 표시하지 않아요. 포지션은 투수·포수·내야수·외야수 네 가지예요.</p>
    <p className="example-caption">매일 한국 시간 자정에 새 문제가 열려요. 기록과 도감은 이 기기에 저장돼요. 영문 검색명 일부는 공식 표기와 다를 수 있어요.</p>
    <p className="example-caption">연봉은 2026 KBO 프로필의 연봉을 원화로 환산한 금액이에요. 데이터 기준일: {SNAPSHOT_DATE}.</p>
    {exchangePolicies.map((player) => <p className="example-caption" key={player.salaryCurrency + player.fxDate}>
      {player.salaryCurrency} 1 = {new Intl.NumberFormat("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(player.fxRate)}원 · {player.fxDate} 고정 환율
    </p>)}
    {!RELEASE_READY && <p className="example-caption">현재는 선수 소속을 확인 중인 미리보기예요.</p>}
  </>;
}
function CollectionContent({ collectionDates }: { collectionDates: Record<string, string> }) {
  const ids = Object.keys(collectionDates).filter((id) => playerMap.has(id));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? playerMap.get(selectedId) : undefined;
  return <>
    <div className="collection-summary" role="status">
      <div><span>오늘의 챌린지</span><h3>2026 KBO 도감</h3></div>
      <strong>{ids.length}<small> / {players.length}</small></strong>
    </div>
    {selected ? <div className="collection-detail">
      <button type="button" className="collection-detail-back" onClick={() => setSelectedId(null)} autoFocus><Icon name="chevron" />도감으로 돌아가기</button>
      <div className="collection-detail-card"><PlayerAvatar player={selected} /><div className="collection-detail-info">
        <strong>{selected.name}</strong><span>{selected.club} · {selected.number}</span><span>획득일 {collectionDates[selected.id].replaceAll("-", ".")}</span>
      </div></div>
    </div> : !ids.length ? <p className="collection-empty">아직 수집한 선수가 없어요. 오늘의 선수를 맞히면 첫 획득 날짜와 함께 카드가 모여요.</p> :
      <ul className="collection-grid">{[...ids].reverse().map((id) => {
        const player = playerMap.get(id)!;
        const date = collectionDates[id];
        return <li className="collection-card" key={id}><button type="button" className="collection-card-button" onClick={() => setSelectedId(id)}
          aria-label={player.name + ", " + player.club + ", 획득일 " + date + ", 카드 보기"}>
          <PlayerAvatar player={player} /><span className="collection-thumb-date" aria-hidden="true">{date.slice(5).replace("-", ".")}</span>
          <div className="collection-card-info"><strong>{player.name}</strong><span>{player.club}</span><span className="collection-card-date">획득일 {date.replaceAll("-", ".")}</span></div>
        </button></li>;
      })}</ul>}
  </>;
}
function StatsContent({ state }: { state: GameState }) {
  const stats = state.stats;
  const average = stats.won ? stats.distribution.reduce((sum, n, i) => sum + n * (i + 1), 0) / stats.won : null;
  return <>
    <div className="stats-grid">{[
      [stats.played, "완료한 도전"],
      [stats.played ? Math.round(stats.won / stats.played * 100) + "%" : "—", "승률"],
      [average === null ? "—" : average.toFixed(1) + "회", "평균 시도 횟수"],
      [stats.streak, "현재 연승"], [stats.best, "최고 연승"],
    ].map(([value, label]) => <div key={label} className={label === "평균 시도 횟수" ? "stats-average" : undefined}><strong>{value}</strong><span>{label}</span></div>)}</div>
    <h3 className="distribution-title">몇 번 만에 맞혔나요?</h3>
    <div className="distribution">{stats.distribution.slice(0, MAX_TOTAL_ATTEMPTS).map((n, i) => <div key={i}><span>{i + 1}</span>
      <div className="distribution-bar" style={{ width: Math.max(7, n / Math.max(1, ...stats.distribution) * 100) + "%" }}>{n}</div>
    </div>)}</div>
    {!stats.played && <p className="example-caption">첫 번째 오늘의 챌린지를 완료하면 기록이 쌓여요.</p>}
  </>;
}
function CollectionAnimation({
  player,
  iconRef,
  onComplete,
}: {
  player: Player;
  iconRef: RefObject<HTMLButtonElement | null>;
  onComplete: () => void;
}) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const bookAnchorRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLSpanElement>(null);
  const useVisibleSourceRef = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const updatePath = () => {
      const scene = sceneRef.current;
      const card = cardRef.current;
      const book = bookAnchorRef.current;
      const icon = iconRef.current;
      const source = sourceRef.current;
      if (!scene || !card || !book || !icon || !source) return;
      const sceneRect = scene.getBoundingClientRect();
      const bookRect = book.getBoundingClientRect();
      const iconRect = icon.getBoundingClientRect();
      const iconX = iconRect.left + iconRect.width / 2;
      const iconY = iconRect.top + iconRect.height / 2;
      if (useVisibleSourceRef.current === null)
        useVisibleSourceRef.current =
          iconX < sceneRect.left ||
          iconX > sceneRect.right ||
          iconY < sceneRect.top ||
          iconY > sceneRect.bottom;
      source.style.left = `${Math.min(Math.max(iconX - sceneRect.left - 22, 12), Math.max(12, sceneRect.width - 56))}px`;
      source.style.opacity = useVisibleSourceRef.current ? "1" : "0";
      const originRect = useVisibleSourceRef.current
        ? source.getBoundingClientRect()
        : iconRect;
      scene.style.setProperty(
        "--book-origin-x",
        `${originRect.left + originRect.width / 2 - (bookRect.left + bookRect.width / 2)}px`,
      );
      scene.style.setProperty(
        "--book-origin-y",
        `${originRect.top + originRect.height / 2 - (bookRect.top + bookRect.height / 2)}px`,
      );
      scene.style.setProperty(
        "--flight-y",
        `${bookRect.top + 58 - (sceneRect.top + card.offsetTop)}px`,
      );
    };
    updatePath();
    const frame = requestAnimationFrame(updatePath);
    window.addEventListener("resize", updatePath);
    window.addEventListener("scroll", updatePath, { passive: true });
    window.visualViewport?.addEventListener("resize", updatePath);
    window.visualViewport?.addEventListener("scroll", updatePath);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePath);
      window.removeEventListener("scroll", updatePath);
      window.visualViewport?.removeEventListener("resize", updatePath);
      window.visualViewport?.removeEventListener("scroll", updatePath);
    };
  }, [iconRef]);
  return (
    <div
      ref={sceneRef}
      className="collection-animation"
      aria-hidden="true"
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) onComplete();
      }}
    >
      <div ref={cardRef} className="collection-animation-card">
        <PlayerAvatar player={player} />
        <div className="collection-animation-card-info">
          <span>선수카드</span>
          <strong>{player.name}</strong>
          <small>{player.club}</small>
        </div>
      </div>
      <span ref={sourceRef} className="collection-animation-source">
        <Icon name="book" />
      </span>
      <div ref={bookAnchorRef} className="collection-animation-book-anchor">
        <div className="collection-animation-book">
          <svg viewBox="0 0 200 115" fill="none" aria-hidden="true">
            <ellipse cx="100" cy="101" rx="90" ry="10" fill="currentColor" opacity=".16" />
            <path
              d="M10 22Q51 8 100 26q49-18 90-4v70q-44-12-90 8-46-20-90-8Z"
              fill="var(--accent-soft)"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              d="M18 16Q59 5 100 25v67Q58 71 18 82Z"
              fill="var(--surface)"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M182 16q-41-11-82 9v67q42-21 82-10Z"
              fill="var(--surface)"
              stroke="currentColor"
              strokeWidth="2"
            />
            <path
              d="M100 25v67M30 36q28-5 55 6M30 51q28-5 55 6m85-21q-28-5-55 6m55 9q-28-5-55 6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2"
              opacity=".65"
            />
          </svg>
          <span>오늘의 챌린지 도감</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const rewarded = useRewardedAd();
  const [theme, setTheme] = useState<"light" | "dark">(() => document.documentElement.dataset.theme === "light" ? "light" : "dark");
  const [state, dispatch] = useReducer(reducer, undefined, () => {
    try { return restore(localStorage.getItem(STORAGE_KEY)); } catch { return restore(null); }
  });
  const [modal, setModal] = useState<ModalType>(null);
  const [toast, setToast] = useState("");
  const [tick, setTick] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const collectionIconRef = useRef<HTMLButtonElement>(null);
  const [collectionAnimation, setCollectionAnimation] = useState<{ player: Player; roundKey: string } | null>(null);
  const round = state.round;
  const answer = playerMap.get(round.answer)!;
  const rewardOffer = round.status === "rewardOffer";
  const finished = round.status === "won" || round.status === "lost";
  const done = Number(finished);
  const roundKey = state.date + ":" + round.answer;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f4f6f9" : "#101722");
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* Theme still works for this visit. */ }
  }, [theme]);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); setStorageError(false); } catch { setStorageError(true); }
  }, [state]);
  useEffect(() => {
    const update = () => { setTick(Date.now()); dispatch({ type: "day", date: dayKey() }); };
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  useEffect(() => {
    const update = () => setShowScrollTop(window.scrollY > 320);
    update(); window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setCollectionAnimation((current) => current?.roundKey === roundKey ? current : null);
    setCopied(false);
  }, [roundKey]);
  useEffect(() => {
    if (!collectionAnimation) return;
    const timer = window.setTimeout(() => setCollectionAnimation(null), 3900);
    return () => window.clearTimeout(timer);
  }, [collectionAnimation]);
  const tomorrow = Date.parse(state.date + "T00:00:00+09:00") + 86_400_000;
  const seconds = Math.max(0, Math.floor((tomorrow - tick) / 1000));
  const countdown = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((n) => String(n).padStart(2, "0")).join(":");
  const submitGuess = (id: string) => {
    if (id === round.answer && round.status === "playing" && !round.guesses.includes(id) &&
      round.guesses.length < round.maxAttempts && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCollectionAnimation({ player: answer, roundKey });
    }
    dispatch({ type: "guess", id });
  };
  const share = async () => {
    try { await navigator.clipboard.writeText(shareText(state)); setCopied(true); setToast("결과를 복사했어요. 친구에게 공유해 보세요."); }
    catch { setModal("share"); }
  };
  const offerAction = { answer: round.answer, date: state.date, offerAtGuess: round.guesses.length };
  return <div className="app-shell"><main className="page">
    <section className="hero" aria-labelledby="game-title">
      <div className="hero-copy">
        <div className="hero-top">
          <div className="eyebrow"><span className="live-dot" /><span className="eyebrow-label">BASEBALL IDENTITY QUIZ</span></div>
          <div className="hero-utilities">
            <button ref={collectionIconRef} type="button" className="icon-button" onClick={() => setModal("collection")} aria-label={"선수 도감 보기, " + Object.keys(state.collectionDates).length + "장 수집"} title="선수 도감"><Icon name="book" /></button>
            <button type="button" className="icon-button theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "밝은 테마로 전환" : "어두운 테마로 전환"}><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
            <button type="button" className="icon-button" onClick={() => setModal("stats")} aria-label="내 기록 보기"><Icon name="chart" /></button>
            <button type="button" className="icon-button" onClick={() => setModal("help")} aria-label="게임 방법 보기"><Icon name="help" /></button>
          </div>
        </div>
        <h1 id="game-title">WHO <span className="logo-am">AM</span> I<span className="logo-question">?</span></h1>
        <p className="hero-korean">이 선수, 누구일까요?</p>
      </div>
      <div className="hero-art" aria-hidden="true"><ParticleBall theme={theme} /></div>
    </section>
    <div className="mode-bar">
      <div className="mode-tabs"><div className="daily-mode-label" id="daily-title"><Icon name="calendar" />오늘의 챌린지<span className="tab-count">1</span></div></div>
      <span className="date-label">{state.date.replaceAll("-", ".")} <span className="date-dot" />새로운 도전이 기다려요</span>
    </div>
    {storageError && <p className="storage-warning" role="status">브라우저에 기록을 저장할 수 없어요. 현재 화면에서는 계속 플레이할 수 있어요.</p>}
    <div className="content-grid">
      <section className="game-panel" id="game-panel" aria-labelledby="daily-title">
        <div className="board-top">
          <div className="pool-badges"><span className="pool-badge"><span className="pool-symbol kbo-pool-symbol" aria-hidden="true"><BaseballMark /></span>2026 KBO</span><span className="pool-detail">TOP {players.length}</span></div>
          <div className="daily-progress" aria-label={done + "/1 완료"}><span className={"day-step current " + (round.status === "won" ? "solved" : round.status === "lost" ? "failed" : "")}>{round.status === "won" ? <Icon name="check" width="15" height="15" /> : 1}</span></div>
        </div>
        <div className="question-area">
          <span className="section-kicker">DAILY CHALLENGE</span>
          <h2>{rewardOffer ? "기회가 더 필요하신가요?" : finished ? round.status === "won" ? "정답을 찾았어요!" : "정답을 확인해 보세요" : "어떤 선수일까요?"}</h2>
          <p>{rewardOffer ? "정답은 아직 공개되지 않았어요." : finished ? "단서를 연결한 당신의 추측을 돌아보세요." : "단서를 모아 정답에 가까워져 보세요."}</p>
        </div>
        {round.status === "playing" && <Search key={roundKey} guesses={round.guesses} onGuess={submitGuess} />}
        {rewardOffer && <div className="result-card reward-offer" role="status">
          <h3>현재 기회를 모두 사용했어요</h3>
          <p className="result-message">{rewarded.available ? "광고를 끝까지 보면 1번 더 도전할 수 있어요. 이번 문제에서 광고를 " + (MAX_REWARDED_ADS - round.rewardAdsWatched) + "번 더 볼 수 있어요." : "정답을 확인하고 이번 도전을 마칠 수 있어요."}</p>
          <div className="result-buttons">
            {rewarded.available && <button type="button" className="button primary" disabled={!rewarded.ready || rewarded.showing}
              onClick={() => rewarded.showIfReady(() => dispatch({ type: "grantReward", ...offerAction }))}>{rewarded.showing ? "광고 재생 중" : rewarded.ready ? "광고 보고 1번 더 도전" : "광고 준비 중"}</button>}
            <button type="button" className="button secondary" onClick={() => dispatch({ type: "finish", ...offerAction })}>정답 확인하기</button>
          </div>
        </div>}
        {finished && <div className={"result-card " + (round.status === "won" ? "result-won" : "")} role="status">
          <div className="result-player"><PlayerAvatar player={answer} /><div><span className="result-eyebrow">{round.status === "won" ? "GREAT SCOUTING" : "GAME OVER"}</span><h3>{answer.name}</h3><p>{answer.club} · {answer.number}</p></div><span className="result-score">{round.status === "won" ? round.guesses.length : "X"}/{round.maxAttempts}</span></div>
          <p className="result-message">{round.status === "won" ? round.guesses.length + "번 만에 선수를 맞혔어요." : "오늘의 도전을 마쳤어요. 내일 새로운 선수를 맞혀보세요."}</p>
          {round.status === "won" && <button type="button" className="collection-earned" onClick={() => setModal("collection")}><Icon name="book" /><span>이 선수카드를 도감에서 확인하세요</span></button>}
          <div className="result-buttons"><button type="button" className="button secondary" onClick={share}><Icon name={copied ? "check" : "share"} />{copied ? "복사 완료" : "결과 공유"}</button><button type="button" className="button primary" onClick={() => setModal("stats")}>기록 보기</button></div>
        </div>}
        <div className="attempts-caption"><span><span className="attempt-number">{String(round.guesses.length).padStart(2, "0")}</span> / {String(round.maxAttempts).padStart(2, "0")} <span className="attempt-label">시도</span></span>
          <div className="attempt-dots" aria-label={Math.max(0, round.maxAttempts - round.guesses.length) + "번의 기회 남음"}>{Array.from({ length: round.maxAttempts }, (_, i) => <i key={i} className={i < round.guesses.length ? "used" : ""} />)}</div>
        </div>
        <div className="guess-history" aria-live="polite" aria-label="추측 기록">
          {finished && round.status === "lost" && <article className="guess-row"><div className="guess-row-title"><strong>정답의 선수 정보</strong><span className="guess-status">{answer.name}</span></div><div className="clue-grid clue-grid-daily">{compare(answer, answer).map((clue) => <Tile key={clue.key} clue={clue} />)}</div></article>}
          {round.guesses.length ? [...round.guesses].reverse().map((id, index) => {
            const player = playerMap.get(id)!;
            return <article className="guess-row" key={id}>
              <div className="guess-row-title"><div><span className="guess-order">{String(round.guesses.length - index).padStart(2, "0")}</span><strong>{player.name}</strong>{player.latinSource !== "romanized" && <span className="guess-latin">{player.latin}</span>}</div>
                <span className="guess-status">{id === round.answer ? <><Icon name="check" />정답</> : (round.guesses.length - index) + "번째 추측"}</span>
              </div>
              <div className="clue-grid clue-grid-daily">{compare(player, answer).map((clue) => <Tile key={clue.key} clue={clue} />)}</div>
            </article>;
          }) : round.status === "playing" && <div className="first-guess">
            <div className="empty-pitch baseball-field"><svg className="diamond-outline" viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="m50 85-35-35 35-35 35 35Z M32 68l18-18 18 18 M15 50Q50 5 85 50" stroke="currentColor" /></svg><Icon name="search" width="26" height="26" /></div>
            <strong>첫 번째 추측이 플레이볼이에요</strong><p>떠오르는 선수부터 시작해 보세요.<br />추측할 때마다 단서가 공개돼요.</p>
            <div className="empty-categories empty-categories-daily">{categories.map((category, i) => <span key={category}>{category}<i>{String(i + 1).padStart(2, "0")}</i></span>)}</div>
          </div>}
        </div>
        <div className="board-footer"><span className="footer-legend"><i className="match-dot" />일치<i className="miss-dot" />불일치</span>{finished && <span className="finished-label">이번 도전 완료<Icon name="check" width="16" height="16" /></span>}</div>
      </section>
      <aside className="side-panel"><div className="daily-card-row">
        <section className="daily-card"><span className="section-kicker">EVERY DAY, A NEW CHALLENGE</span><div className="daily-card-bottom"><div><span>오늘의 진행</span><strong>{done}<small> / 1</small></strong></div><div className="countdown"><span>다음 도전까지</span><strong>{countdown}</strong></div></div><div className="daily-track"><span style={{ width: done * 100 + "%" }} /></div></section>
        <button type="button" className="records-icon" aria-label="나의 스카우팅 기록 보기" onClick={() => setModal("stats")}><Icon name="chart" /><span>스카우팅 기록</span></button>
      </div></aside>
    </div>
    <p className="data-preview-note">2026 시즌 · 데이터 기준 {SNAPSHOT_DATE}{DEMO_DATA ? " · 연습 데이터" : !RELEASE_READY ? " · 미리보기" : ""}</p>
  </main>
  {showScrollTop && !modal && !toast && <button type="button" className="scroll-top" aria-label="맨 위로 이동" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })}><Icon name="arrow" /></button>}
  {toast && <div className="toast" role="status"><Icon name="check" />{toast}</div>}
  {collectionAnimation && <CollectionAnimation key={collectionAnimation.roundKey} player={collectionAnimation.player} iconRef={collectionIconRef} onComplete={() => setCollectionAnimation(null)} />}
  {modal && <Modal title={modal === "help" ? "게임 방법" : modal === "stats" ? "나의 스카우팅 기록" : modal === "collection" ? "선수 도감" : "결과 공유"} onClose={() => setModal(null)}>
    {modal === "help" ? <HelpContent /> : modal === "stats" ? <StatsContent state={state} /> : modal === "collection" ? <CollectionContent collectionDates={state.collectionDates} /> : <><p className="modal-intro">아래 결과를 복사해 친구에게 공유하세요.</p><textarea className="share-fallback" aria-label="공유할 결과" readOnly value={shareText(state)} onFocus={(event) => event.target.select()} /></>}
  </Modal>}
  </div>;
}
