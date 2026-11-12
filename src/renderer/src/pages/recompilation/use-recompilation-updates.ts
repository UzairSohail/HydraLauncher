import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AddUpdateSourceInput,
  RecompilationActionResult,
  RecompilationUpdateState,
  UpdateChannel,
  UpdateProviderInfo,
  UpdateSourceActionResult,
  UpdateSourceState,
} from "@types";
import { logger } from "@renderer/logger";

export interface RecompilationUpdates {
  state: RecompilationUpdateState | null;
  providers: UpdateProviderInfo[];
  bestSource: UpdateSourceState | null;
  isChecking: boolean;
  refresh: () => Promise<void>;
  checkNow: () => Promise<void>;
  addSource: (input: AddUpdateSourceInput) => Promise<UpdateSourceActionResult>;
  updateSource: (
    sourceId: string,
    patch: { channel?: UpdateChannel; assetFilter?: string | null }
  ) => Promise<UpdateSourceActionResult>;
  removeSource: (sourceId: string) => Promise<UpdateSourceActionResult>;
  installFrom: (sourceId: string) => Promise<RecompilationActionResult>;
  rollback: () => Promise<RecompilationActionResult>;
  openSnapshots: () => Promise<boolean>;
}

export function useRecompilationUpdates(
  objectId: string,
  slug: string
): RecompilationUpdates {
  const ref = useMemo(() => ({ objectId, slug }), [objectId, slug]);
  const [state, setState] = useState<RecompilationUpdateState | null>(null);
  const [providers, setProviders] = useState<UpdateProviderInfo[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await window.electron.getRecompilationUpdateState(ref));
    } catch (error) {
      logger.error("Failed to load recompilation update state", error);
    }
  }, [ref]);

  const loadProviders = useCallback(async () => {
    try {
      setProviders(await window.electron.getUpdateProviders());
    } catch (error) {
      logger.error("Failed to load update providers", error);
    }
  }, []);

  useEffect(() => {
    setState(null);
    void refresh();
    void loadProviders();
    const offUpdates = window.electron.onRecompilationUpdatesChanged(
      () => void refresh()
    );
    const offProviders = window.electron.onUpdateProvidersChanged(
      () => void loadProviders()
    );
    return () => {
      offUpdates();
      offProviders();
    };
  }, [refresh, loadProviders]);

  const checkNow = useCallback(async () => {
    setIsChecking(true);
    try {
      setState(await window.electron.checkRecompilationUpdates(ref));
    } finally {
      setIsChecking(false);
    }
  }, [ref]);

  const withRefresh =
    <Args extends unknown[], Result>(
      action: (...args: Args) => Promise<Result>
    ) =>
    async (...args: Args) => {
      const result = await action(...args);
      await refresh();
      return result;
    };

  const bestSource =
    state?.sources.find((source) => source.id === state.bestSourceId) ?? null;

  return {
    state,
    providers,
    bestSource,
    isChecking,
    refresh,
    checkNow,
    addSource: withRefresh((input: AddUpdateSourceInput) =>
      window.electron.addRecompilationUpdateSource(ref, input)
    ),
    updateSource: withRefresh(
      (
        sourceId: string,
        patch: { channel?: UpdateChannel; assetFilter?: string | null }
      ) => window.electron.updateRecompilationUpdateSource(ref, sourceId, patch)
    ),
    removeSource: withRefresh((sourceId: string) =>
      window.electron.removeRecompilationUpdateSource(ref, sourceId)
    ),
    installFrom: withRefresh((sourceId: string) =>
      window.electron.installRecompilationFromSource(ref, sourceId)
    ),
    rollback: withRefresh(() => window.electron.rollbackRecompilation(ref)),
    openSnapshots: () => window.electron.openRecompilationSaveSnapshots(ref),
  };
}
