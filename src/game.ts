import dataset from "./players.json";
import schedule from "./daily-schedule.json";

export type Position = "투수" | "포수" | "내야수" | "외야수";
export interface Player {
  id: string;
  name: string;
  latin: string;
  latinSource?: "wikidata" | "romanized";
  club: string;
  position: Position;
  birthYear: number;
  number: string;
  heightCm: number;
  salaryOriginalAmount: number;
  salaryCurrency: string;
  salaryDefinition: string;
  salaryKRW: number;
  fxRate: number;
  fxDate: string;
  sourceUrl: string;
  snapshotDate: string;
  season: 2026;
}
export type Category =
  | "club"
  | "position"
  | "birthYear"
  | "number"
  | "heightCm"
  | "salaryKRW";
export interface Clue {
  key: Category;
  label: string;
  value: string;
  match: "exact" | "miss";
  direction?: "up" | "down";
}
export type RoundStatus = "playing" | "rewardOffer" | "won" | "lost";
export interface Round {
  answer: string;
  guesses: string[];
  maxAttempts: number;
  rewardAdsWatched: number;
  status: RoundStatus;
}
export interface DailyResult {
  date: string;
  answer: string;
  won: boolean;
  attempts: number;
}
export interface Stats {
  totalAttempts: number;
  played: number;
  won: number;
  streak: number;
  best: number;
  distribution: number[];
}
export interface GameState {
  version: 1;
  date: string;
  round: Round;
  collectionDates: Record<string, string>;
  history: DailyResult[];
  stats: Stats;
}
export const MAX_ATTEMPTS = 5;
export const MAX_REWARDED_ADS = 3;
export const MAX_TOTAL_ATTEMPTS = MAX_ATTEMPTS + MAX_REWARDED_ADS;
export const DATA_VERSION = dataset.version;
export const DEMO_DATA = dataset.demo;
export const RELEASE_READY = (dataset as unknown as { releaseReady?: boolean }).releaseReady === true;
export const SNAPSHOT_DATE = dataset.snapshotDate;
export const players: Player[] = dataset.players as unknown as Player[];
export const playerMap = new Map(players.map((player) => [player.id, player]));
export const categories = [
  "구단",
  "포지션",
  "출생연도",
  "등번호",
  "키",
  "연봉",
] as const;
const scheduledPlayers: string[] = schedule.players;
const startTimestamp = Date.parse(schedule.startDate + "T00:00:00Z");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const validDateKey = (value: string) => {
  if (!datePattern.test(value)) return false;
  const timestamp = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
};

export function dayKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function dailyAnswer(date: string): string {
  const timestamp = Date.parse(date + "T00:00:00Z");
  if (!validDateKey(date) || !scheduledPlayers.length) {
    throw new Error("일일 문제 일정이 올바르지 않습니다.");
  }
  const offset = Math.floor((timestamp - startTimestamp) / 86_400_000);
  return scheduledPlayers[((offset % scheduledPlayers.length) + scheduledPlayers.length) % scheduledPlayers.length];
}

export const makeRound = (answer: string): Round => ({
  answer,
  guesses: [],
  maxAttempts: MAX_ATTEMPTS,
  rewardAdsWatched: 0,
  status: "playing",
});

const emptyStats = (): Stats => ({
  totalAttempts: 0,
  played: 0,
  won: 0,
  streak: 0,
  best: 0,
  distribution: Array(MAX_TOTAL_ATTEMPTS).fill(0),
});

export function initialState(date = dayKey()): GameState {
  return {
    version: 1,
    date,
    round: makeRound(dailyAnswer(date)),
    collectionDates: {},
    history: [],
    stats: emptyStats(),
  };
}

function previousDate(date: string): string {
  const timestamp = Date.parse(date + "T00:00:00Z") - 86_400_000;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function statsFromHistory(history: DailyResult[]): Stats {
  const stats = emptyStats();
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  let priorDate = "";
  for (const result of sorted) {
    stats.played++;
    stats.totalAttempts += result.attempts;
    if (result.won) {
      stats.won++;
      stats.distribution[result.attempts - 1]++;
      stats.streak = priorDate === previousDate(result.date) ? stats.streak + 1 : 1;
      stats.best = Math.max(stats.best, stats.streak);
    } else {
      stats.streak = 0;
    }
    priorDate = result.date;
  }
  return stats;
}

function finishRound(state: GameState, round: Round): GameState {
  if (round.status !== "won" && round.status !== "lost") {
    return { ...state, round };
  }
  if (state.history.some((result) => result.date === state.date)) {
    return { ...state, round };
  }
  const won = round.status === "won";
  const history = [
    ...state.history,
    { date: state.date, answer: round.answer, won, attempts: round.guesses.length },
  ];
  const collectionDates =
    won && !state.collectionDates[round.answer]
      ? { ...state.collectionDates, [round.answer]: state.date }
      : state.collectionDates;
  return { ...state, round, collectionDates, history, stats: statsFromHistory(history) };
}

export type Action =
  | { type: "guess"; id: string }
  | { type: "grantReward" | "finish"; answer: string; date: string; offerAtGuess: number }
  | { type: "day"; date: string };

export function reducer(state: GameState, action: Action): GameState {
  if (action.type === "day") {
    if (action.date === state.date) return state;
    return { ...state, date: action.date, round: makeRound(dailyAnswer(action.date)) };
  }
  const round = state.round;
  if (action.type === "guess") {
    if (
      round.status !== "playing" ||
      !playerMap.has(action.id) ||
      round.guesses.includes(action.id) ||
      round.guesses.length >= round.maxAttempts
    ) return state;
    const guesses = [...round.guesses, action.id];
    const status: RoundStatus =
      action.id === round.answer
        ? "won"
        : guesses.length === round.maxAttempts
          ? round.rewardAdsWatched < MAX_REWARDED_ADS
            ? "rewardOffer"
            : "lost"
          : "playing";
    return finishRound(state, { ...round, guesses, status });
  }
  if (
    round.status !== "rewardOffer" ||
    round.rewardAdsWatched >= MAX_REWARDED_ADS ||
    round.maxAttempts !== MAX_ATTEMPTS + round.rewardAdsWatched ||
    round.guesses.length !== round.maxAttempts ||
    action.offerAtGuess !== round.guesses.length ||
    action.answer !== round.answer ||
    action.date !== state.date
  ) return state;
  if (action.type === "grantReward") {
    return {
      ...state,
      round: {
        ...round,
        rewardAdsWatched: round.rewardAdsWatched + 1,
        maxAttempts: round.maxAttempts + 1,
        status: "playing",
      },
    };
  }
  return finishRound(state, { ...round, status: "lost" });
}

export function salaryText(value: number): string {
  const rounded = Math.round(value);
  const eok = Math.floor(rounded / 100_000_000);
  const man = Math.floor((rounded % 100_000_000) / 10_000);
  const won = rounded % 10_000;
  const parts: string[] = [];
  if (eok) parts.push(`${eok.toLocaleString("ko-KR")}억`);
  if (man) parts.push(`${man.toLocaleString("ko-KR")}만`);
  if (won || !parts.length) parts.push(`${won.toLocaleString("ko-KR")}원`);
  else parts.push("원");
  return parts.join(" ");
}

export function compare(guess: Player, answer: Player): Clue[] {
  const text = (key: Category, label: string, value: string, equal: boolean): Clue => ({
    key, label, value, match: equal ? "exact" : "miss",
  });
  const numeric = (key: Category, label: string, value: string, current: number, target: number, equal = current === target): Clue => ({
    key,
    label,
    value,
    match: equal ? "exact" : "miss",
    ...(!equal && current !== target ? { direction: current < target ? "up" as const : "down" as const } : {}),
  });
  return [
    text("club", "구단", guess.club, guess.club === answer.club),
    text("position", "포지션", guess.position, guess.position === answer.position),
    numeric("birthYear", "출생연도", `${guess.birthYear}년`, guess.birthYear, answer.birthYear),
    numeric("number", "등번호", guess.number, Number(guess.number), Number(answer.number), guess.number === answer.number),
    numeric("heightCm", "키", `${guess.heightCm}cm`, guess.heightCm, answer.heightCm),
    numeric("salaryKRW", "연봉", salaryText(guess.salaryKRW), guess.salaryKRW, answer.salaryKRW),
  ];
}

const normalize = (value: string) =>
  value.normalize("NFC").replace(/[\s.\-']/g, "").toLocaleLowerCase();
const chosung = (value: string) =>
  [...value].map((letter) => {
    const code = letter.charCodeAt(0) - 44032;
    return code >= 0 && code < 11172
      ? "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"[Math.floor(code / 588)]
      : letter;
  }).join("");

export function searchPlayers(query: string, guessed: string[] = []): Player[] {
  const normalized = normalize(query.trim());
  if (!normalized) return [];
  const used = new Set(guessed);
  return players
    .filter((player) =>
      !used.has(player.id) &&
      (normalize(player.name).includes(normalized) ||
        normalize(player.latin).includes(normalized) ||
        normalize(chosung(player.name)).includes(normalized)))
    .sort((a, b) =>
      Number(normalize(b.name).startsWith(normalized)) -
      Number(normalize(a.name).startsWith(normalized)) ||
      a.name.localeCompare(b.name, "ko"))
    .slice(0, 10);
}

function validRound(round: Round): boolean {
  if (!round || !playerMap.has(round.answer) || !Array.isArray(round.guesses)) return false;
  if (!Number.isInteger(round.rewardAdsWatched) || round.rewardAdsWatched < 0 || round.rewardAdsWatched > MAX_REWARDED_ADS) return false;
  if (round.maxAttempts !== MAX_ATTEMPTS + round.rewardAdsWatched) return false;
  if (round.guesses.length > round.maxAttempts || new Set(round.guesses).size !== round.guesses.length) return false;
  if (!round.guesses.every((id) => playerMap.has(id))) return false;
  if (!["playing", "rewardOffer", "won", "lost"].includes(round.status)) return false;
  if (round.status === "won") return round.guesses.at(-1) === round.answer;
  if (round.guesses.includes(round.answer)) return false;
  if (round.status === "playing") return round.guesses.length < round.maxAttempts;
  if (round.status === "rewardOffer") return round.guesses.length === round.maxAttempts && round.rewardAdsWatched < MAX_REWARDED_ADS;
  return round.guesses.length === round.maxAttempts;
}

export function restore(raw: string | null, date = dayKey()): GameState {
  const fresh = () => initialState(date);
  if (!raw) return fresh();
  try {
    const saved = JSON.parse(raw) as GameState;
    if (
      saved.version !== 1 ||
      !validDateKey(saved.date) ||
      !validRound(saved.round) ||
      !Array.isArray(saved.history) ||
      !saved.collectionDates ||
      typeof saved.collectionDates !== "object" ||
      Array.isArray(saved.collectionDates)
    ) return fresh();
    const seen = new Set<string>();
    if (!saved.history.every((result) => {
      if (
        !result ||
        !validDateKey(result.date) ||
        !playerMap.has(result.answer) ||
        typeof result.won !== "boolean" ||
        !Number.isInteger(result.attempts) ||
        result.attempts < 1 ||
        result.attempts > MAX_TOTAL_ATTEMPTS ||
        seen.has(result.date)
      ) return false;
      seen.add(result.date);
      return true;
    })) return fresh();
    if (!Object.entries(saved.collectionDates).every(([id, acquired]) =>
      playerMap.has(id) && typeof acquired === "string" && validDateKey(acquired)
    )) return fresh();
    const state: GameState = { ...saved, stats: statsFromHistory(saved.history) };
    return saved.date === date ? state : reducer(state, { type: "day", date });
  } catch {
    return fresh();
  }
}

export function shareText(state: GameState): string {
  const { round, date } = state;
  const result = round.status === "won" ? `${round.guesses.length}/${round.maxAttempts}` : "X";
  const cells = round.guesses.map((id) => {
    const guess = playerMap.get(id)!;
    const answer = playerMap.get(round.answer)!;
    return compare(guess, answer).map((clue) => clue.match === "exact" ? "🟩" : clue.direction ? "🟨" : "⬛").join("");
  }).join("\n");
  return `2026 야구 선수 맞히기 · ${date}\n${result}\n${cells}`;
}
