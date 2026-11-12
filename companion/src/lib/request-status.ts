import {
  ANY_DEVICE,
  isFinishedRequestState,
  resolveAnyClaim,
  type CompanionDeviceDocument,
  type CompanionRequest,
  type CompanionRequestState,
} from "../../../src/shared/companion";

export interface RequestView {
  state: CompanionRequestState | "waiting";
  progress?: number;
  error?: string;
  /** The computer handling it, once one has. */
  device: CompanionDeviceDocument | null;
}

/** Where a request stands, from the launchers' own files. */
export const requestStatus = (
  request: CompanionRequest,
  devices: CompanionDeviceDocument[]
): RequestView => {
  let device: CompanionDeviceDocument | null = null;
  if (request.target === ANY_DEVICE) {
    const winner = resolveAnyClaim(request.id, devices);
    device = devices.find((candidate) => candidate.id === winner) ?? null;
    if (!device) {
      // Every computer that looked skipped it or failed it.
      const failed = devices.find(
        (candidate) => candidate.requests[request.id]?.state === "failed"
      );
      if (failed) {
        const status = failed.requests[request.id];
        return { state: "failed", error: status.error, device: failed };
      }
      return { state: "waiting", device: null };
    }
  } else {
    device = devices.find((candidate) => candidate.id === request.target) ?? null;
  }

  const status = device?.requests[request.id];
  if (!status) return { state: "waiting", device };
  return {
    state: status.state,
    progress: status.progress,
    error: status.error,
    device,
  };
};

export const describeState = (view: RequestView, targetName: string) => {
  switch (view.state) {
    case "waiting":
      return `Starts when Nacho opens on ${targetName}`;
    case "claimed":
      return `${targetName} is taking this`;
    case "queued":
      return `Queued on ${targetName}`;
    case "downloading":
      return `Downloading on ${targetName}`;
    case "done":
      return `Downloaded on ${targetName}`;
    case "failed":
      return view.error ? `Failed: ${view.error}` : "Failed";
    case "cancelled":
      return `Cancelled on ${targetName}`;
    case "skipped":
      return "Another computer took this";
  }
};

/** Whether the phone can stop following a request. */
export const isFinished = (view: RequestView) =>
  view.state !== "waiting" && isFinishedRequestState(view.state);
