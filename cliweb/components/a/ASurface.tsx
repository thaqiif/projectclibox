/**
 * ASurface — the one place that decides what a plane is made of.
 *
 * Liquid Glass is the *control* layer: chrome, navigation, menus, transient
 * overlays. Content — terminals, editors, diffs, file trees — stays opaque,
 * because nothing should read text through a blur. Routing every panel
 * through this component is what keeps that line from blurring (so to speak)
 * as the app grows.
 *
 * @example
 * ```tsx
 * <ASurface material="regular" edge="bottom">…toolbar…</ASurface>
 * <ASurface material="thick" float rounded="xl">…menu…</ASurface>
 * <ASurface material="solid">…file tree…</ASurface>
 * ```
 */

"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type SurfaceMaterial =
  /** Hover states, chips over busy content. */
  | "ultrathin"
  /** Small controls, segmented tracks, inline chips. */
  | "thin"
  /** The default for chrome: toolbars, tab bars, sidebars. */
  | "regular"
  /** Menus, popovers, dialogs, sheets — anything that covers content. */
  | "thick"
  /** Opaque. Content surfaces, and anything sitting on top of glass. */
  | "solid"
  /** Opaque and lifted a step, for cards and rows on a solid canvas. */
  | "raised";

export type SurfaceEdge = "none" | "top" | "bottom" | "right" | "rim";

const MATERIALS: Record<SurfaceMaterial, string> = {
  ultrathin: "glass-ultrathin",
  thin: "glass-thin",
  regular: "glass",
  thick: "glass-thick",
  solid: "bg-background",
  raised: "bg-surface-raised",
};

const EDGES: Record<SurfaceEdge, string> = {
  none: "",
  top: "glass-edge-top",
  bottom: "glass-edge-bottom",
  right: "glass-edge-right",
  rim: "",
};

const RADII = {
  none: "",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  full: "rounded-full",
} as const;

export interface ASurfaceProps extends React.HTMLAttributes<HTMLElement> {
  material?: SurfaceMaterial;
  /** Which edge catches the light. `rim` lights the whole perimeter. */
  edge?: SurfaceEdge;
  /** Lift the surface off the canvas with a soft depth shadow. */
  float?: boolean;
  rounded?: keyof typeof RADII;
  /** Pick up the accent colour, the way a selected control does. */
  tinted?: boolean;
  as?: React.ElementType;
}

export const ASurface = forwardRef<HTMLElement, ASurfaceProps>(
  (
    {
      material = "regular",
      edge = "rim",
      float = false,
      rounded = "none",
      tinted = false,
      as: Tag = "div",
      className,
      ...props
    },
    ref
  ) => {
    const isGlass = material !== "solid" && material !== "raised";

    return (
      <Tag
        ref={ref}
        data-material={material}
        className={cn(
          MATERIALS[material],
          isGlass && float && "glass-float",
          isGlass && !float && EDGES[edge],
          tinted && "glass-tinted",
          RADII[rounded],
          !isGlass && float && "shadow-[var(--elev-2)]",
          className
        )}
        {...props}
      />
    );
  }
);

ASurface.displayName = "ASurface";
