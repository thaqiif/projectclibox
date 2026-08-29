"use client";

import { useState, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/query-client";
import { parseTheme, getAllThemes } from "@/lib/theme-config";
import { FontScaleProvider } from "@/contexts/FontScaleContext";

function ThemeClassHandler({ children }: { children: React.ReactNode }) {
  const { theme, systemTheme } = useTheme();

  useEffect(() => {
    const root = document.documentElement;
    let actualTheme = theme;
    if (theme === "system") {
      actualTheme = systemTheme || "dark";
    }
    const { mode, variant } = parseTheme(actualTheme || "dark");
    root.classList.remove("dark", "light");
    root.removeAttribute("data-theme-variant");
    root.classList.add(mode === "system" ? "dark" : mode);
    if (variant && variant !== "default" && variant !== "deep") {
      root.setAttribute("data-theme-variant", variant);
    }

    // Update theme-color meta tag to match the actual background
    const updateThemeColor = () => {
      const bg = getComputedStyle(root).getPropertyValue("--background").trim();
      if (bg) {
        const [h, s, l] = bg.split(" ");
        const themeColor = `hsl(${h}, ${s}, ${l})`;
        let metaTag = document.querySelector('meta[name="theme-color"]');
        if (!metaTag) {
          metaTag = document.createElement("meta");
          metaTag.setAttribute("name", "theme-color");
          document.head.appendChild(metaTag);
        }
        metaTag.setAttribute("content", themeColor);
      }
    };

    // Small delay to ensure CSS variables are computed after class changes
    requestAnimationFrame(updateThemeColor);
  }, [theme, systemTheme]);

  return <>{children}</>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <NextThemesProvider
        attribute="data-theme"
        defaultTheme="dark"
        enableSystem
        disableTransitionOnChange
        themes={getAllThemes()}
      >
        <FontScaleProvider>
          <ThemeClassHandler>
            <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          </ThemeClassHandler>
        </FontScaleProvider>
      </NextThemesProvider>
    </QueryClientProvider>
  );
}
