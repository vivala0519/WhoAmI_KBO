import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadFullScreenAd,
  showFullScreenAd,
} from "@apps-in-toss/web-framework";

const TEST_ID = "ait-ad-test-rewarded-id";
const adGroupId = import.meta.env.DEV
  ? TEST_ID
  : import.meta.env.VITE_TOSS_REWARDED_AD_GROUP_ID;

export function useRewardedAd() {
  const [available, setAvailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [settled, setSettled] = useState(false);
  const [showing, setShowing] = useState(false);
  const showRef = useRef<(onReward: () => void) => boolean>(() => false);

  useEffect(() => {
    if (!adGroupId) {
      setSettled(true);
      return;
    }
    let alive = true;
    let loaded = false;
    let unregisterLoad: (() => void) | undefined;
    let unregisterShow: (() => void) | undefined;
    try {
      if (!loadFullScreenAd.isSupported() || !showFullScreenAd.isSupported()) {
        setSettled(true);
        return;
      }
    } catch {
      setSettled(true);
      return;
    }
    setAvailable(true);
    const markReady = (value: boolean) => {
      loaded = value;
      if (alive) setReady(value);
    };
    const load = () => {
      if (!alive) return;
      unregisterLoad?.();
      unregisterLoad = undefined;
      markReady(false);
      try {
        unregisterLoad = loadFullScreenAd({
          options: { adGroupId },
          onEvent: (event) => {
            if (alive && event.type === "loaded") {
              markReady(true);
              setSettled(true);
            }
          },
          onError: (error) => {
            if (!alive) return;
            markReady(false);
            setSettled(true);
            console.warn("보상형 광고를 불러오지 못했어요.", error);
          },
        });
      } catch (error) {
        markReady(false);
        setSettled(true);
        console.warn("보상형 광고를 불러오지 못했어요.", error);
      }
    };
    showRef.current = (onReward) => {
      if (!alive || !loaded) return false;
      markReady(false);
      setShowing(true);
      unregisterLoad?.();
      unregisterLoad = undefined;
      unregisterShow?.();
      unregisterShow = undefined;
      let rewarded = false;
      try {
        unregisterShow = showFullScreenAd({
          options: { adGroupId },
          onEvent: (event) => {
            if (!alive) return;
            if (event.type === "userEarnedReward" && !rewarded) {
              rewarded = true;
              onReward();
            }
            if (event.type === "dismissed" || event.type === "failedToShow") {
              setShowing(false);
              unregisterShow?.();
              unregisterShow = undefined;
              load();
            }
          },
          onError: (error) => {
            if (!alive) return;
            console.warn("보상형 광고를 표시하지 못했어요.", error);
            setShowing(false);
            unregisterShow?.();
            unregisterShow = undefined;
            load();
          },
        });
      } catch (error) {
        console.warn("보상형 광고를 표시하지 못했어요.", error);
        setShowing(false);
        load();
        return false;
      }
      return true;
    };
    load();
    return () => {
      alive = false;
      loaded = false;
      showRef.current = () => false;
      unregisterLoad?.();
      unregisterShow?.();
    };
  }, []);

  const showIfReady = useCallback(
    (onReward: () => void) => showRef.current(onReward),
    [],
  );
  return { available, ready, settled, showing, showIfReady };
}
