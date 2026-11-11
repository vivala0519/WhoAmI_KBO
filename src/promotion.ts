import { dayKey, isPublishedAnswer, MAX_TOTAL_ATTEMPTS } from "./game";
import type { DailyResult } from "./game";

export const PROMOTION_STREAK_DAYS = 5;
export const PROMOTION_REWARD_AMOUNT = 500;

export interface PromotionMilestone {
  id: string;
  startDate: string;
  endDate: string;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

function validResult(result: DailyResult): boolean {
  return typeof result.won === "boolean" &&
    Number.isInteger(result.attempts) &&
    result.attempts >= 1 && result.attempts <= MAX_TOTAL_ATTEMPTS &&
    isPublishedAnswer(result.date, result.answer);
}

function evaluate(history: readonly DailyResult[], today: string) {
  const milestones: PromotionMilestone[] = [];
  if (!validDate(today)) return { milestones, progress: 0 };

  const dates = new Map<string, DailyResult | null>();
  for (const result of history) {
    if (!result || !validDate(result.date) || result.date > today) continue;
    const prior = dates.get(result.date);
    // Identical entries count once; conflicting or invalid entries cannot earn points.
    if (!validResult(result) || (dates.has(result.date) &&
      (!prior || prior.answer !== result.answer || prior.won !== result.won || prior.attempts !== result.attempts))) {
      dates.set(result.date, null);
    } else if (!dates.has(result.date)) {
      dates.set(result.date, result);
    }
  }

  let lastDate = "";
  let runLength = 0;
  let blockStart = "";
  for (const [date, result] of [...dates].sort(([left], [right]) => left.localeCompare(right))) {
    if (!result?.won) {
      runLength = 0;
    } else {
      if (lastDate !== previousDate(date)) runLength = 0;
      runLength += 1;
      if (runLength % PROMOTION_STREAK_DAYS === 1) blockStart = date;
      if (runLength % PROMOTION_STREAK_DAYS === 0) {
        milestones.push({ id: `${blockStart}:${date}`, startDate: blockStart, endDate: date });
      }
    }
    lastDate = date;
  }

  const progress = runLength === 0 ? 0
    : lastDate === today ? (runLength - 1) % PROMOTION_STREAK_DAYS + 1
    : lastDate === previousDate(today) ? runLength % PROMOTION_STREAK_DAYS
    : 0;
  return { milestones, progress };
}

/** Every five consecutive daily wins earns one non-overlapping reward milestone. */
export function getPromotionMilestones(history: readonly DailyResult[], today = dayKey()): PromotionMilestone[] {
  return evaluate(history, today).milestones;
}

/** A completed block stays at five today, then starts at zero on the next day. */
export function getPromotionProgress(history: readonly DailyResult[], today = dayKey()): number {
  return evaluate(history, today).progress;
}
