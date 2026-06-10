import { create } from 'zustand';

export type Mode = 'buyer' | 'seller';

interface UiState {
  mode: Mode;
  setMode: (m: Mode) => void;
  bump: number; // increment to trigger a global data refresh (balances, listings)
  refresh: () => void;
}

export const useUi = create<UiState>((set) => ({
  mode: 'buyer',
  setMode: (mode) => set({ mode }),
  bump: 0,
  refresh: () => set((s) => ({ bump: s.bump + 1 })),
}));
