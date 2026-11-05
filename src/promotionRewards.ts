import { Promotion, User } from "@apps-in-toss/web-framework";
import { dailyAnswer, dayKey, MAX_TOTAL_ATTEMPTS } from "./game";
import type { DailyResult } from "./game";
import { getPromotionMilestones, PROMOTION_REWARD_AMOUNT } from "./promotion";
import type { PromotionMilestone } from "./promotion";
import { LIVE_PROMOTION_CODE, PROMOTION_END_DATE, PROMOTION_START_DATE } from "./promotionConfig";

export const PROMOTION_TEST_MODE = import.meta.env?.DEV === true ||
  import.meta.env?.VITE_TOSS_PROMOTION_TEST === "true";
const promotionCode = PROMOTION_TEST_MODE ? `TEST_${LIVE_PROMOTION_CODE}` : LIVE_PROMOTION_CODE;
const ledgerPrefix = `who-am-i-kbo:promotion:v1:${PROMOTION_TEST_MODE ? "test" : "live"}:${promotionCode}`;
const ownerMapKey = `who-am-i-kbo:promotion-owners:v1:${PROMOTION_TEST_MODE ? "test" : "live"}:${promotionCode}`;

type RewardAttempt = { status: "attempted" | "paid"; attemptDate: string; key?: string };
type RewardLedger = Record<string, RewardAttempt>;
type HistoryOwners = Record<string, string>;
export type PromotionOutcome =
  | { status: "paid"; previouslyPaid: boolean }
  | { status: "unsupported" }
  | { status: "retryable"; code: string }
  | { status: "unavailable"; code: string }
  | { status: "uncertain" }
  | { status: "storageError" }
  | { status: "ineligible" }
  | { status: "dailyLimit" };

const inFlight = new Map<string, Promise<PromotionOutcome>>();
const queues = new Map<string, Promise<void>>();
const rejectedCodes = new Set(["40000", "4100", "4109", "4110", "4112", "4114", "4116", "4095", "UNSUPPORTED_APP_VERSION"]);
const retryableCodes = new Set(["4109", "4110", "4095"]);

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function withinPromotion(today: string): boolean {
  return today === dayKey() && today >= PROMOTION_START_DATE && today <= PROMOTION_END_DATE;
}

function readLedger(ledgerKey: string): RewardLedger {
  const raw = localStorage.getItem(ledgerKey);
  if (raw === null) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid promotion ledger");
  for (const [slot, candidate] of Object.entries(value)) {
    if ((slot !== "sdk-test" && !validDate(slot)) || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Invalid promotion ledger entry");
    }
    const attempt = candidate as RewardAttempt;
    if (!validDate(attempt.attemptDate) || !["attempted", "paid"].includes(attempt.status) ||
      (attempt.status === "paid" && (typeof attempt.key !== "string" || !attempt.key.trim()))) {
      throw new Error("Invalid promotion ledger attempt");
    }
  }
  return value as RewardLedger;
}

function writeLedger(ledgerKey: string, ledger: RewardLedger) {
  localStorage.setItem(ledgerKey, JSON.stringify(ledger));
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "UNKNOWN_ERROR";
}

function readOwners(): HistoryOwners {
  const raw = localStorage.getItem(ownerMapKey);
  if (raw === null) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !Object.entries(value).every(([date, hash]) => validDate(date) && date >= PROMOTION_START_DATE &&
      date <= PROMOTION_END_DATE && typeof hash === "string" && hash.trim().length > 0)) {
    throw new Error("Invalid promotion history owners");
  }
  return value as HistoryOwners;
}

function ownedHistory(history: readonly DailyResult[], owners: HistoryOwners, hash: string, today: string): DailyResult[] {
  return history.filter((result) => result && validDate(result.date) &&
    result.date >= PROMOTION_START_DATE && result.date <= PROMOTION_END_DATE &&
    result.date <= today && owners[result.date] === hash);
}

function todaysWin(history: readonly DailyResult[], today: string): boolean {
  const rows = history.filter((result) => result?.date === today);
  const first = rows[0];
  return rows.length > 0 && rows.every((result) => result.won === true &&
    result.answer === dailyAnswer(today) && Number.isInteger(result.attempts) &&
    result.attempts >= 1 && result.attempts <= MAX_TOTAL_ATTEMPTS && result.attempts === first.attempts);
}

async function currentAccount(): Promise<{ status: "account"; hash: string } | PromotionOutcome> {
  try {
    if (!Promotion.grantReward.isSupported() || !User.getAnonymousKey.isSupported()) return { status: "unsupported" };
  } catch {
    return { status: "unsupported" };
  }
  try {
    const user = await User.getAnonymousKey();
    if (user?.type !== "HASH" || typeof user.hash !== "string" || !user.hash.trim()) {
      return { status: "retryable", code: "IDENTITY_UNAVAILABLE" };
    }
    return { status: "account", hash: user.hash };
  } catch (error) {
    const code = errorCode(error);
    return code === "UNSUPPORTED_APP_VERSION" ? { status: "unsupported" } : { status: "retryable", code };
  }
}

/** Bind only today's actual win to its first Toss account; past days are never adopted retroactively. */
export async function syncPromotionHistory(
  history: readonly DailyResult[],
  today = dayKey(),
): Promise<{ status: "ready"; history: DailyResult[] } | PromotionOutcome> {
  if (!withinPromotion(today)) return { status: "ineligible" };
  const account = await currentAccount();
  if (account.status !== "account") return account;
  try {
    return await serialize(ownerMapKey, async () => {
      if (!withinPromotion(today)) return { status: "ineligible" } as const;
      const owners = readOwners();
      if (!owners[today] && todaysWin(history, today)) {
        owners[today] = account.hash;
        localStorage.setItem(ownerMapKey, JSON.stringify(owners));
      }
      return { status: "ready", history: ownedHistory(history, owners, account.hash, today) } as const;
    });
  } catch {
    return { status: "storageError" };
  }
}

async function grantWithLedger(ledgerKey: string, slot: string, today: string): Promise<PromotionOutcome> {
  if (!withinPromotion(today)) return { status: "ineligible" };
  let ledger: RewardLedger;
  try {
    ledger = readLedger(ledgerKey);
  } catch {
    return { status: "storageError" };
  }
  if (ledger[slot]?.status === "paid") return { status: "paid", previouslyPaid: true };
  if (ledger[slot]?.status === "attempted") return { status: "uncertain" };
  const todayAttempts = Object.values(ledger).filter((attempt) => attempt.attemptDate === today);
  if (todayAttempts.some((attempt) => attempt.status === "attempted")) return { status: "uncertain" };
  if (todayAttempts.some((attempt) => attempt.status === "paid")) return { status: "dailyLimit" };

  const attempt: RewardAttempt = { status: "attempted", attemptDate: today };
  try {
    // Persist before calling Toss: an interrupted response must not trigger another grant.
    writeLedger(ledgerKey, { ...ledger, [slot]: attempt });
  } catch {
    return { status: "storageError" };
  }
  try {
    const result = await Promotion.grantReward({ promotionCode, amount: PROMOTION_REWARD_AMOUNT });
    if (!result || typeof result.key !== "string" || !result.key.trim()) return { status: "uncertain" };
    try {
      writeLedger(ledgerKey, { ...readLedger(ledgerKey), [slot]: { ...attempt, status: "paid", key: result.key } });
    } catch {
      // A confirmed grant stays successful; the durable attempted marker still blocks a duplicate.
    }
    return { status: "paid", previouslyPaid: false };
  } catch (error) {
    const code = errorCode(error);
    if (!rejectedCodes.has(code)) return { status: "uncertain" };
    // Clear only explicit no-payment responses. Unknown failures, including 4113, remain blocked.
    try {
      const current = readLedger(ledgerKey);
      delete current[slot];
      writeLedger(ledgerKey, current);
    } catch {
      return { status: "storageError" };
    }
    if (code === "UNSUPPORTED_APP_VERSION") return { status: "unsupported" };
    return { status: retryableCodes.has(code) ? "retryable" : "unavailable", code };
  }
}

function serialize<T>(ledgerKey: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(ledgerKey) ?? Promise.resolve();
  const result = previous.then(async () => {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request(ledgerKey, task);
    }
    return await task();
  });
  const tail = result.then(() => undefined, () => undefined);
  queues.set(ledgerKey, tail);
  void tail.then(() => { if (queues.get(ledgerKey) === tail) queues.delete(ledgerKey); });
  return result;
}

async function grant(
  slot: string,
  today: string,
  ownership?: { milestone: PromotionMilestone; history: readonly DailyResult[] },
): Promise<PromotionOutcome> {
  if (!withinPromotion(today)) return { status: "ineligible" };
  const account = await currentAccount();
  if (account.status !== "account") return account;
  if (ownership) {
    try {
      const eligible = await serialize(ownerMapKey, async () => {
        const history = ownedHistory(ownership.history, readOwners(), account.hash, today);
        return getPromotionMilestones(history, today).some((candidate) =>
          candidate.id === ownership.milestone.id && candidate.startDate === ownership.milestone.startDate &&
          candidate.endDate === ownership.milestone.endDate);
      });
      if (!eligible) return { status: "ineligible" };
    } catch {
      return { status: "storageError" };
    }
  }
  const ledgerKey = `${ledgerPrefix}:${encodeURIComponent(account.hash)}`;
  const requestKey = `${ledgerKey}:${slot}`;
  const existing = inFlight.get(requestKey);
  if (existing) return existing;
  const request = serialize(ledgerKey, () => grantWithLedger(ledgerKey, slot, today))
    .catch(() => ({ status: "storageError" } as const))
    .finally(() => inFlight.delete(requestKey));
  inFlight.set(requestKey, request);
  return request;
}

export function grantPromotionMilestone(
  milestone: PromotionMilestone,
  history: readonly DailyResult[],
  today = dayKey(),
): Promise<PromotionOutcome> {
  if (!withinPromotion(today)) return Promise.resolve({ status: "ineligible" });
  const eligible = getPromotionMilestones(history.filter((result) =>
    result?.date >= PROMOTION_START_DATE && result.date <= PROMOTION_END_DATE), today)
    .some((candidate) => candidate.id === milestone.id && candidate.startDate === milestone.startDate && candidate.endDate === milestone.endDate);
  if (!eligible) return Promise.resolve({ status: "ineligible" });
  // End-date slots stay stable even if local history is later restored in a different order.
  return grant(milestone.endDate, today, { milestone, history });
}

export function grantPromotionTest(): Promise<PromotionOutcome> {
  if (!PROMOTION_TEST_MODE) return Promise.resolve({ status: "ineligible" });
  return grant("sdk-test", dayKey());
}
