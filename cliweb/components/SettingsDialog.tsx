"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check } from "lucide-react";
import { useFontScale } from "@/contexts/FontScaleContext";
import { normalizeFontScale } from "@/lib/font-scale";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const FONT_FAMILIES = [
  { value: "default", label: "Default (SF Pro / Geist Sans)", css: "" },
  { value: "inter", label: "Inter", css: "Inter, sans-serif" },
  { value: "roboto", label: "Roboto", css: "Roboto, sans-serif" },
  { value: "open-sans", label: "Open Sans", css: '"Open Sans", sans-serif' },
  { value: "lato", label: "Lato", css: "Lato, sans-serif" },
];

/** Persist one setting to the backing store, showing brief feedback. */
function saveSetting(key: string, value: string) {
  void fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  })
    .then(() => {
      toast.success("Saved", {
        icon: <Check className="h-4 w-4" />,
        duration: 1500,
      });
    })
    .catch(() => {
      toast.error("Failed to save setting");
    });
}

function applyFontFamily(familyKey: string) {
  const match = FONT_FAMILIES.find((f) => f.value === familyKey);
  if (match && match.css) {
    document.documentElement.style.setProperty("--font-sans", match.css);
  } else {
    document.documentElement.style.removeProperty("--font-sans");
  }
}

/**
 * Appearance preferences.
 *
 * Same no-scrim, top-right-anchored pattern as the theme picker: settings
 * are pointless to change if the thing they affect is dimmed out behind
 * the dialog.
 */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { fontScale, setFontScale } = useFontScale();
  const [fontFamily, setFontFamily] = useState("default");
  const [loaded, setLoaded] = useState(false);

  // Load persisted settings once on mount.
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ settings }: { settings: Record<string, string> }) => {
        const scale = normalizeFontScale(parseFloat(settings.fontScale || ""));
        const family = settings.fontFamily || "default";
        setFontScale(scale);
        setFontFamily(family);
        applyFontFamily(family);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [setFontScale]);

  if (!loaded) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="bg-transparent"
        className="glass-thick glass-float max-h-[90vh] grid-rows-[auto_1fr_auto] gap-0 overflow-hidden border-0 shadow-[var(--elev-glass)] sm:top-4 sm:right-4 sm:bottom-4 sm:left-auto sm:max-w-sm sm:translate-x-0 sm:translate-y-0"
      >
        <DialogHeader className="edge-fade-bottom flex h-10 shrink-0 flex-row items-center px-5 pt-4 pb-3">
          <DialogTitle className="type-headline">Settings</DialogTitle>
        </DialogHeader>

        <div className="scrollbar-thin min-h-0 overflow-y-auto px-5 py-4">
          <section className="mb-6">
            <h3 className="ui-label mb-3">Appearance</h3>

            <div className="mb-4">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[0.8125rem] font-medium">
                  Font scale
                </label>
                <span className="ui-meta tabular-nums">
                  {fontScale.toFixed(2)}x
                </span>
              </div>
              <input
                type="range"
                min={0.8}
                max={1.2}
                step={0.05}
                value={fontScale}
                onChange={(e) => {
                  const value = e.target.valueAsNumber;
                  setFontScale(value);
                  saveSetting("fontScale", String(value));
                }}
                className="w-full accent-[var(--primary)]"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-[0.8125rem] font-medium">
                Font family
              </label>
              <Select
                value={fontFamily}
                onValueChange={(value) => {
                  setFontFamily(value);
                  applyFontFamily(value);
                  saveSetting("fontFamily", value);
                }}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FONT_FAMILIES.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>
        </div>

        <div className="edge-fade-top flex items-center justify-between px-5 py-3">
          <span className="ui-meta">Press Esc or click outside to close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
