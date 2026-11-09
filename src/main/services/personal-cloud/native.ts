import type {
  PersonalCloudGameInfo,
  PersonalCloudLinkInput,
  PersonalCloudLinkResult,
  PersonalCloudStatus,
  PersonalCloudSyncResult,
  PersonalCloudVersion,
} from "@types";

/** The napi functions in native/hydra-native/src/personal_cloud.rs. */
export interface PersonalCloudNativeModule {
  personalCloudStatus: () => Promise<PersonalCloudStatus>;
  personalCloudBeginSignIn: () => Promise<string>;
  personalCloudFinishSignIn: () => Promise<void>;
  personalCloudSetPaused: (paused: boolean) => Promise<void>;
  personalCloudLinkGame: (
    input: PersonalCloudLinkInput
  ) => Promise<PersonalCloudLinkResult>;
  personalCloudAdoptGame: (
    gameId: string,
    name: string,
    folder: string
  ) => Promise<void>;
  personalCloudSync: (
    gameId: string,
    afterPlay: boolean
  ) => Promise<PersonalCloudSyncResult>;
  personalCloudLearnAfterPlay: (
    gameId: string,
    startedAtMs: number
  ) => Promise<PersonalCloudSyncResult>;
  personalCloudPlayingStart: (gameId: string) => void;
  personalCloudPlayingStop: (gameId: string) => void;
  personalCloudGameInfo: (gameId: string) => Promise<PersonalCloudGameInfo>;
  personalCloudForceUpload: (gameId: string) => Promise<PersonalCloudVersion>;
  personalCloudForceDownload: (gameId: string) => Promise<PersonalCloudVersion>;
  personalCloudRestoreVersion: (
    gameId: string,
    versionId: string
  ) => Promise<PersonalCloudVersion>;
  personalCloudDeleteVersion: (
    gameId: string,
    versionId: string
  ) => Promise<void>;
  personalCloudReadFile: (key: string) => Promise<Buffer | null>;
  personalCloudWriteFile: (key: string, data: Buffer) => Promise<void>;
}
