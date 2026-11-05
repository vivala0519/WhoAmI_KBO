import { useCallback, useEffect, useRef, useState } from "react";
import { loadFullScreenAd, showFullScreenAd } from "@apps-in-toss/web-framework";

const TEST_ID = "ait-ad-test-rewarded-id";
const adGroupId = import.meta.env.DEV || import.meta.env.VITE_TOSS_AD_TEST === "true"
  ? TEST_ID
  : import.meta.env.VITE_TOSS_REWARDED_AD_GROUP_ID?.trim();

export function useRewardedAd() {
  const [available, setAvailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [settled, setSettled] = useState(false);
  const [showing, setShowing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showRef = useRef<(onReward: () => void) => boolean>(() => false);
  const retryRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!adGroupId) { setSettled(true); return; }
    try {
      if (!loadFullScreenAd.isSupported() || !showFullScreenAd.isSupported()) {
        setSettled(true);
        return;
      }
    } catch { setSettled(true); return; }

    let alive = true;
    let loaded = false;
    let loading = false;
    let displaying = false;
    let loadGeneration = 0;
    let showGeneration = 0;
    let unregisterLoad: (() => void) | undefined;
    let unregisterShow: (() => void) | undefined;
    setAvailable(true);

    const markReady = (value: boolean) => {
      loaded = value;
      if (alive) setReady(value);
    };
    const clearLoad = () => {
      const unregister = unregisterLoad;
      unregisterLoad = undefined;
      unregister?.();
    };
    const clearShow = () => {
      const unregister = unregisterShow;
      unregisterShow = undefined;
      unregister?.();
    };
    const load = () => {
      if (!alive || loading || displaying || loaded) return;
      const generation = ++loadGeneration;
      clearLoad();
      loading = true;
      markReady(false);
      setSettled(false);
      setError(null);
      const fail = () => {
        if (!alive || generation !== loadGeneration || !loading) return;
        loading = false;
        markReady(false);
        setSettled(true);
        setError("광고를 불러오지 못했어요. 다시 불러오거나 정답을 확인해 주세요.");
        clearLoad();
      };
      try {
        const unregister = loadFullScreenAd({
          options: { adGroupId },
          onEvent: (event) => {
            if (!alive || generation !== loadGeneration || !loading || event.type !== "loaded") return;
            loading = false;
            markReady(true);
            setSettled(true);
            setError(null);
            clearLoad();
          },
          onError: fail,
        });
        // A mock or native bridge may settle before returning its cleanup.
        if (alive && generation === loadGeneration && loading) unregisterLoad = unregister;
        else unregister();
      } catch { fail(); }
    };
    retryRef.current = load;
    showRef.current = (onReward) => {
      if (!alive || !loaded || displaying) return false;
      const generation = ++showGeneration;
      displaying = true;
      markReady(false);
      setShowing(true);
      setError(null);
      clearLoad();
      clearShow();
      let rewarded = false;
      let closed = false;
      const finish = () => {
        if (!alive || generation !== showGeneration || closed) return;
        closed = true;
        displaying = false;
        setShowing(false);
        clearShow();
        load();
      };
      try {
        const unregister = showFullScreenAd({
          options: { adGroupId },
          onEvent: (event) => {
            if (!alive || generation !== showGeneration || closed) return;
            if (event.type === "userEarnedReward" && !rewarded) {
              rewarded = true;
              onReward();
            }
            if (event.type === "dismissed" || event.type === "failedToShow") finish();
          },
          onError: finish,
        });
        if (alive && generation === showGeneration && !closed) unregisterShow = unregister;
        else unregister();
      } catch {
        finish();
        return false;
      }
      return true;
    };
    load();
    return () => {
      alive = false;
      loaded = false;
      loading = false;
      displaying = false;
      loadGeneration++;
      showGeneration++;
      showRef.current = () => false;
      retryRef.current = () => {};
      clearLoad();
      clearShow();
    };
  }, []);

  const showIfReady = useCallback((onReward: () => void) => showRef.current(onReward), []);
  const retryLoad = useCallback(() => retryRef.current(), []);
  return { available, ready, settled, showing, error, retryLoad, showIfReady };
}
