// Who hears what. Pure, so the rule is written once and tested.
//
//  - The Owner's and the Mixer's levels ARE the saved final mix. They edit it
//    and always hear it.
//  - Everyone else can choose: "monitor" (a personal mix, like a stage
//    monitor — never saved to the song) or "final" (the saved mix, read-only).
//  - Solo is a listening aid: never saved, for anyone.

export type ListeningMode = "monitor" | "final";

export interface ChannelMix {
  volume: number;
  muted: boolean;
  solo: boolean;
}

export function effectiveChannelMix(params: {
  saved: { volume: number; muted: boolean };
  canMix: boolean;
  listeningMode: ListeningMode;
  personal?: { volume: number; muted: boolean };
  solo: boolean;
}): ChannelMix {
  const { saved, canMix, listeningMode, personal, solo } = params;
  if (canMix || listeningMode === "final") return { volume: saved.volume, muted: saved.muted, solo };
  return { volume: personal?.volume ?? 1, muted: personal?.muted ?? false, solo };
}
