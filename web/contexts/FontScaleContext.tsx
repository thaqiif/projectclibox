"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_FONT_SCALE, normalizeFontScale } from "@/lib/font-scale";

interface FontScaleContextValue {
  fontScale: number;
  setFontScale: (scale: number) => void;
}

const FontScaleContext = createContext<FontScaleContextValue | null>(null);

export function FontScaleProvider({ children }: { children: ReactNode }) {
  const [fontScale, setFontScaleState] = useState(DEFAULT_FONT_SCALE);

  const setFontScale = useCallback((scale: number) => {
    setFontScaleState(normalizeFontScale(scale));
  }, []);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontScale * 100}%`;
  }, [fontScale]);

  return (
    <FontScaleContext.Provider value={{ fontScale, setFontScale }}>
      {children}
    </FontScaleContext.Provider>
  );
}

export function useFontScale(): FontScaleContextValue {
  const context = useContext(FontScaleContext);
  if (!context) {
    throw new Error("useFontScale must be used within a FontScaleProvider");
  }
  return context;
}
