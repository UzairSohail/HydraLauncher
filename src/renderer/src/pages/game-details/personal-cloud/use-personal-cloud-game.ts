import { useCallback, useEffect, useRef, useState } from "react";

import type { GameShop, PersonalCloudGameState } from "@types";

/** Cloud Save Manager state for one game, refreshed after every sync. */
export function usePersonalCloudGame(
  shop: GameShop | undefined,
  objectId: string | undefined,
  /** Changes when the game's executable changes, so the game is re-linked. */
  executablePath?: string | null
) {
  const [state, setState] = useState<PersonalCloudGameState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    if (!shop || !objectId) return;
    const id = ++requestId.current;
    setIsLoading(true);
    try {
      const next = await window.electron.getPersonalCloudGameState(
        shop,
        objectId
      );
      if (id !== requestId.current) return;
      setState(next);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (id === requestId.current) setIsLoading(false);
    }
  }, [shop, objectId]);

  useEffect(() => {
    setState(null);
    void refresh();
  }, [refresh, executablePath]);

  useEffect(
    () =>
      window.electron.onPersonalCloudSync((event) => {
        if (event.shop === shop && event.objectId === objectId) void refresh();
      }),
    [shop, objectId, refresh]
  );

  /** Runs an action, then refreshes. Rejects with the action's error. */
  const run = useCallback(
    async <T>(action: () => Promise<T>): Promise<T> => {
      setIsBusy(true);
      try {
        return await action();
      } finally {
        setIsBusy(false);
        void refresh();
      }
    },
    [refresh]
  );

  return { state, isLoading, isBusy, error, refresh, run };
}
