import { createContext } from 'react';

export interface CanvasActions {
  showHidden: boolean;
  toggleCollapse: (id: string) => void;
}

export const CanvasActionsContext = createContext<CanvasActions>({
  showHidden: false,
  toggleCollapse: () => {},
});
