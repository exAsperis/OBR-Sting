import { createContext, useContext } from "react";

const NumericLimitsContext = createContext(false);

export const NumericLimitsProvider = NumericLimitsContext.Provider;

export function useAllowOutOfBounds(): boolean {
  return useContext(NumericLimitsContext);
}
