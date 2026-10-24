import { create } from "zustand";

/** Whether the "Set up your sound" guide is open (it is opened from the project page's prompt and from Settings > Input). */
interface SetupState {
  open: boolean;
  openGuide: () => void;
  closeGuide: () => void;
}

export const useSetupStore = create<SetupState>((set) => ({
  open: false,
  openGuide: () => set({ open: true }),
  closeGuide: () => set({ open: false }),
}));
