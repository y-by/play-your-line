import { create } from "zustand";

/** Whether the "Send feedback" dialog is open, and the unsent text (kept if the person closes it by accident). */
interface FeedbackState {
  open: boolean;
  draft: string;
  openDialog: () => void;
  close: () => void;
  setDraft: (text: string) => void;
}

export const useFeedbackStore = create<FeedbackState>((set) => ({
  open: false,
  draft: "",
  openDialog: () => set({ open: true }),
  close: () => set({ open: false }),
  setDraft: (draft) => set({ draft }),
}));
