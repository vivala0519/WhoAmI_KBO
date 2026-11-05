import { useEffect, useRef, useState } from "react";
import type { DailyResult } from "./game";
import {
  getPromotionMilestones, getPromotionProgress, PROMOTION_REWARD_AMOUNT, PROMOTION_STREAK_DAYS,
} from "./promotion";
import { PROMOTION_END_DATE, PROMOTION_START_DATE } from "./promotionConfig";
import { grantPromotionMilestone, grantPromotionTest, PROMOTION_TEST_MODE, syncPromotionHistory } from "./promotionRewards";
import type { PromotionOutcome } from "./promotionRewards";
import "./promotion.css";

type VisibleOutcome = PromotionOutcome | { status: "pending" } | null;

function outcomeText(outcome: VisibleOutcome) {
  switch (outcome?.status) {
    case "paid": return PROMOTION_TEST_MODE
      ? "테스트 지급을 완료했어요."
      : `${PROMOTION_REWARD_AMOUNT} 토스 포인트 달성 보상 지급 완료`;
    case "pending": return "토스 포인트 지급을 확인하고 있어요.";
    case "unsupported": return "최신 토스 앱에서 지급을 확인해 주세요.";
    case "retryable": return outcome.code === "4109"
      ? "프로모션이 아직 시작되지 않았거나 종료됐어요. 운영 상태 확인 후 다시 시도해 주세요."
      : "포인트를 지급하지 못했어요. 잠시 후 다시 시도해 주세요.";
    case "unavailable": return outcome.code === "4112"
      ? "프로모션 예산이 부족해 지급하지 못했어요. 고객센터에 문의해 주세요."
      : "프로모션 지급 정보를 확인해야 해요. 고객센터에 문의해 주세요.";
    case "uncertain": return "지급 결과를 확인하지 못했어요. 토스 포인트 내역을 확인한 뒤 고객센터에 문의해 주세요.";
    case "storageError": return "지급 기록을 저장할 수 없어요. 기기의 저장 공간과 저장 허용 설정을 확인해 주세요.";
    case "dailyLimit": return "오늘의 지급 한도에 도달했어요. 남은 달성 보상은 내일 다시 확인해 주세요.";
    case "ineligible": return "프로모션 기간에 5일 연속 성공하면 지급 대상이 돼요.";
    default: return "";
  }
}

export function StreakPromotion({ history, today }: { history: readonly DailyResult[]; today: string }) {
  const [ownedHistory, setOwnedHistory] = useState<readonly DailyResult[]>([]);
  const campaignHistory = ownedHistory.filter(({ date }) => date >= PROMOTION_START_DATE && date <= PROMOTION_END_DATE);
  const milestones = getPromotionMilestones(campaignHistory, today);
  const progress = getPromotionProgress(campaignHistory, today);
  const campaignActive = today >= PROMOTION_START_DATE && today <= PROMOTION_END_DATE;
  const [outcome, setOutcome] = useState<VisibleOutcome>(null);
  const [retry, setRetry] = useState(0);
  const busy = useRef(false);
  const historyRef = useRef(ownedHistory);
  historyRef.current = ownedHistory;
  const milestoneKey = milestones.map(({ id }) => id).join("|");

  useEffect(() => {
    if (!campaignActive) return;
    let active = true;
    const sync = async () => {
      const result = await syncPromotionHistory(history, today);
      if (!active) return;
      if ("history" in result) {
        setOwnedHistory(result.history);
        if (getPromotionMilestones(result.history, today).length === 0) setOutcome(null);
      }
      else { setOwnedHistory([]); setOutcome(result); }
    };
    const update = () => void sync().catch(() => {
      if (active) { setOwnedHistory([]); setOutcome({ status: "storageError" }); }
    });
    const onVisible = () => { if (document.visibilityState === "visible") update(); };
    update();
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [campaignActive, history, retry, today]);

  useEffect(() => {
    if (!campaignActive || !milestoneKey) {
      busy.current = false;
      if (!campaignActive) setOutcome(null);
      return;
    }
    let active = true;
    busy.current = true;
    setOutcome({ status: "pending" });
    const grant = async () => {
      for (const milestone of getPromotionMilestones(historyRef.current.filter(({ date }) =>
        date >= PROMOTION_START_DATE && date <= PROMOTION_END_DATE), today)) {
        const result = await grantPromotionMilestone(milestone, historyRef.current, today);
        if (!active) return;
        setOutcome(result);
        if (result.status !== "paid") break;
      }
      if (active) busy.current = false;
    };
    void grant().catch(() => {
      if (active) { busy.current = false; setOutcome({ status: "uncertain" }); }
    });
    return () => { active = false; };
  }, [campaignActive, milestoneKey, retry, today]);

  const test = async () => {
    if (!PROMOTION_TEST_MODE || busy.current) return;
    busy.current = true;
    setOutcome({ status: "pending" });
    try { setOutcome(await grantPromotionTest()); }
    catch { setOutcome({ status: "uncertain" }); }
    finally { busy.current = false; }
  };

  if (!campaignActive && !PROMOTION_TEST_MODE) return null;
  return <section className="streak-promotion" aria-labelledby="streak-promotion-title">
    <div className="streak-promotion-heading">
      <h3 id="streak-promotion-title">5일 연속 성공 챌린지</h3>
      <span>{progress}/{PROMOTION_STREAK_DAYS}일</span>
    </div>
    <p>5일 연속 성공할 때마다 {PROMOTION_REWARD_AMOUNT} 토스 포인트를 지급해요.</p>
    <div className="streak-promotion-track" role="progressbar" aria-label="연속 성공 챌린지 진행"
      aria-valuemin={0} aria-valuemax={PROMOTION_STREAK_DAYS} aria-valuenow={progress}>
      {Array.from({ length: PROMOTION_STREAK_DAYS }, (_, index) =>
        <span key={index} className={index < progress ? "complete" : ""} aria-hidden="true" />)}
    </div>
    <p>실패하거나 하루를 쉬면 1일차부터 다시 시작해요.</p>
    <p className="streak-promotion-period">예산 소진 시 조기 종료</p>
    {outcome && <div className="streak-promotion-result" role="status" aria-live="polite">
      <p>{outcomeText(outcome)}</p>
      {(outcome.status === "retryable" || outcome.status === "storageError") &&
        <button type="button" className="button secondary" onClick={() => setRetry((value) => value + 1)}>지급 다시 확인하기</button>}
    </div>}
    {PROMOTION_TEST_MODE && <div className="streak-promotion-test">
      <strong>프로모션 테스트 모드</strong>
      <p>테스트 코드로 1회 지급을 확인해요.</p>
      <button type="button" className="button secondary" disabled={outcome?.status === "pending"}
        onClick={() => void test()}>테스트 지급 확인</button>
    </div>}
  </section>;
}
