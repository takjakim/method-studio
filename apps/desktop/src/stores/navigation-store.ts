import { create } from 'zustand';

interface NavigationStore {
  pendingNavigation: string | null;
  navigateTo: (path: string) => void;
  clearPendingNavigation: () => void;
}

export const useNavigationStore = create<NavigationStore>((set) => ({
  pendingNavigation: null,
  navigateTo: (path) => set({ pendingNavigation: path }),
  clearPendingNavigation: () => set({ pendingNavigation: null }),
}));
