import { create } from "zustand";

/** Which section dialog is open: adding one at the playhead, or changing an existing mark. */
export type SectionDialog = { mode: "add"; atBeat: number | null } | { mode: "edit"; id: string } | null;

interface SectionUiState {
  dialog: SectionDialog;
  /** Adds a section at a chosen beat, or (no beat) at the bar the playhead is in. */
  openAdd: (atBeat?: number | null) => void;
  openEdit: (id: string) => void;
  close: () => void;
}

export const useSectionUiStore = create<SectionUiState>((set) => ({
  dialog: null,
  openAdd: (atBeat = null) => set({ dialog: { mode: "add", atBeat: typeof atBeat === "number" ? atBeat : null } }),
  openEdit: (id) => set({ dialog: { mode: "edit", id } }),
  close: () => set({ dialog: null }),
}));
