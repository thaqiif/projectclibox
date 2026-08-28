"use client";

import { useTheme } from "next-themes";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DARK_THEMES,
  LIGHT_THEMES,
  parseTheme,
  buildTheme,
  type ThemeOption,
  type DarkThemeVariant,
  type LightThemeVariant,
} from "@/lib/theme-config";
import { cn } from "@/lib/utils";

interface ThemeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Swatch({ preview }: { preview: ThemeOption["preview"] }) {
  return (
    <span
      className="flex h-5 w-8 shrink-0 items-center justify-center gap-0.5 rounded overflow-hidden border border-[var(--fill-2)]"
      style={{ background: preview.background }}
    >
      <span
        className="h-2 w-2 rounded-sm"
        style={{ background: preview.foreground }}
        aria-hidden
      />
      <span
        className="h-2 w-2 rounded-sm"
        style={{ background: preview.accent }}
        aria-hidden
      />
    </span>
  );
}

function ThemeRow({
  label,
  description,
  preview,
  active,
  onClick,
}: {
  label: string;
  description?: string;
  preview?: ThemeOption["preview"];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "press-sm focus-ring relative flex w-full items-center gap-3 py-2 pr-5 pl-4 text-left transition-colors",
        active ? "bg-[var(--fill-3)]" : "hover:bg-[var(--fill-4)]"
      )}
    >
      {active && (
        <span className="bg-primary absolute inset-y-0 left-0 w-[3px] rounded-r-full" />
      )}
      {preview ? <Swatch preview={preview} /> : <span className="w-8" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] font-medium leading-tight">
          {label}
        </span>
        {description && (
          <span className="ui-meta mt-0.5 block truncate">{description}</span>
        )}
      </span>
      {active && <Check className="text-primary h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}

/**
 * Theme picker.
 *
 * This was a hover submenu, which meant every theme you tried closed the
 * menu and you reopened it to try the next one. A dialog stays put: pick as
 * many as you like and dismiss it with Esc or a click outside when the one
 * on screen is the one you want.
 */
export function ThemeDialog({ open, onOpenChange }: ThemeDialogProps) {
  const { theme, setTheme } = useTheme();
  const { mode, variant } = parseTheme(theme || "system");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        // No scrim, and parked against the right edge rather than centred:
        // picking a theme is pointless if the thing it repaints is hidden
        // behind the picker and dimmed to near-black.
        overlayClassName="bg-transparent"
        className="glass-thick glass-float top-4 bottom-4 left-auto right-4 grid-rows-[auto_1fr_auto] translate-x-0 translate-y-0 gap-0 overflow-hidden border-0 shadow-[var(--elev-glass)] sm:max-w-xs"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Theme</DialogTitle>
        </DialogHeader>

        <div className="edge-fade-bottom flex h-10 shrink-0 items-center px-5 pt-4 pb-3">
          <span className="type-headline">Theme</span>
        </div>

        <div className="scrollbar-thin min-h-0 overflow-y-auto py-1">
          <ThemeRow
            label="System"
            description="Follow the operating system"
            active={mode === "system"}
            onClick={() => setTheme("system")}
          />

          <div className="px-5 py-1.5">
            <span className="ui-label">Dark</span>
          </div>
          {DARK_THEMES.map((t) => (
            <ThemeRow
              key={t.id}
              label={t.label}
              description={t.description}
              preview={t.preview}
              active={mode === "dark" && (variant ?? "deep") === t.id}
              onClick={() =>
                setTheme(buildTheme("dark", t.id as DarkThemeVariant))
              }
            />
          ))}

          <div className="px-5 py-1.5">
            <span className="ui-label">Light</span>
          </div>
          {LIGHT_THEMES.map((t) => (
            <ThemeRow
              key={t.id}
              label={t.label}
              description={t.description}
              preview={t.preview}
              active={mode === "light" && (variant ?? "default") === t.id}
              onClick={() =>
                setTheme(buildTheme("light", t.id as LightThemeVariant))
              }
            />
          ))}
        </div>

        <div className="edge-fade-top flex items-center justify-between px-5 py-3">
          <span className="ui-meta">Press Esc or click outside to close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
