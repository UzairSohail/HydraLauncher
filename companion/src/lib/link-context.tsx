import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";

import type {
  CompanionDeviceDocument,
  CompanionDocument,
} from "../../../src/shared/companion";
import * as google from "./google";
import { loadCompanion, loadDevices } from "./link";

const EXTRA_SOURCES_KEY = "extraSourceIds";
const REFRESH_MS = 30_000;

interface LinkState {
  account: google.GoogleAccount | null;
  /** True until the saved sign-in has been checked. */
  restoring: boolean;
  devices: CompanionDeviceDocument[];
  companion: CompanionDocument;
  /** The sources' IDs the catalogue knows, from every launcher. */
  sourceIds: string[];
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  setCompanion: (document: CompanionDocument) => void;
  rememberSourceId: (id: string) => Promise<void>;
}

const LinkContext = createContext<LinkState | null>(null);

export function LinkProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<google.GoogleAccount | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [devices, setDevices] = useState<CompanionDeviceDocument[]>([]);
  const [companion, setCompanion] = useState<CompanionDocument>({
    version: 1,
    requests: [],
    devices: [],
  });
  const [extraSourceIds, setExtraSourceIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshing = useRef<Promise<void> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(EXTRA_SOURCES_KEY)
      .then((value) => value && setExtraSourceIds(JSON.parse(value)))
      .catch(() => undefined);
    google
      .restoreSignIn()
      .then(setAccount)
      .finally(() => setRestoring(false));
  }, []);

  const refresh = useCallback(() => {
    refreshing.current ??= (async () => {
      setLoading(true);
      try {
        const [nextDevices, nextCompanion] = await Promise.all([
          loadDevices(),
          loadCompanion(),
        ]);
        setDevices(nextDevices);
        setCompanion(nextCompanion);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, []);

  useEffect(() => {
    if (!account) return;
    void refresh();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, REFRESH_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [account, refresh]);

  const signIn = useCallback(async () => {
    setError(null);
    try {
      setAccount(await google.signIn());
    } catch (cause) {
      setError(google.describeSignInError(cause));
    }
  }, []);

  const signOut = useCallback(async () => {
    await google.signOut().catch(() => undefined);
    setAccount(null);
    setDevices([]);
  }, []);

  const rememberSourceId = useCallback(
    async (id: string) => {
      const next = Array.from(new Set([...extraSourceIds, id]));
      setExtraSourceIds(next);
      await AsyncStorage.setItem(EXTRA_SOURCES_KEY, JSON.stringify(next)).catch(
        () => undefined
      );
    },
    [extraSourceIds]
  );

  const sourceIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...devices.flatMap((device) => device.sources.map((source) => source.id)),
          ...extraSourceIds,
        ])
      ),
    [devices, extraSourceIds]
  );

  const value = useMemo<LinkState>(
    () => ({
      account,
      restoring,
      devices,
      companion,
      sourceIds,
      loading,
      error,
      signIn,
      signOut,
      refresh,
      setCompanion,
      rememberSourceId,
    }),
    [
      account,
      restoring,
      devices,
      companion,
      sourceIds,
      loading,
      error,
      signIn,
      signOut,
      refresh,
      rememberSourceId,
    ]
  );

  return <LinkContext.Provider value={value}>{children}</LinkContext.Provider>;
}

export const useLink = () => {
  const value = useContext(LinkContext);
  if (!value) throw new Error("useLink must be used inside LinkProvider");
  return value;
};
