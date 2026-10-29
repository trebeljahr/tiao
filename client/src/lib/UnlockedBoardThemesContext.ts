import { createContext } from "react";

/** Theme access for the current account; absent while signed out or bootstrapping. */
export const UnlockedBoardThemesContext = createContext<readonly string[] | undefined>(undefined);
