import { useEffect, useState } from "react";
import type { RecompilationUpdateSummary } from "@types";
import { logger } from "@renderer/logger";

/** Ports with an update waiting, kept current as checks finish. */
export function useRecompilationUpdateSummaries() {
  const [summaries, setSummaries] = useState<RecompilationUpdateSummary[]>([]);

  useEffect(() => {
    const electron = window.electron;
    if (!electron?.getRecompilationUpdateSummaries) return;

    let cancelled = false;
    const load = () =>
      electron
        .getRecompilationUpdateSummaries()
        .then((next) => {
          if (!cancelled) setSummaries(next);
        })
        .catch((error) =>
          logger.error("Failed to load recompilation updates", error)
        );

    void load();
    const off = electron.onRecompilationUpdatesChanged(() => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return summaries;
}
