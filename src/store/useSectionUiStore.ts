import { create } from "zustand";

/** Which section dialog is open: adding one at the playhead, or changing an existing mark. */
export type SectionDialog = { mode: "add" } | { mode: "edit"; id: string } | null;

interface SectionUiState {
  dialog: SectionDialog;
  openAdd: () => void;
  openEdit: (id: string) => void;
  close: () => void;
}

export const useSectionUiStore = create<SectionUiState>((set) => ({
  dialog: null,
  openAdd: () => set({ dialog: { mode: "add" } }),
  openEdit: (id) => set({ dialog: { mode: "edit", id } }),
  close: () => set({ dialog: null }),
}));
