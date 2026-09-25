# CLIWeb shell design system

The terminal renderer and its palette are independent content. The shell frames it with quiet, opaque surfaces. The default dark palette is near black; theme variants shift hue while preserving the same surface roles and control geometry.

## Tokens

| Role | Dark default | Light default | Implementation |
| --- | --- | --- | --- |
| Canvas | `hsl(225 6% 6.5%)` | `hsl(0 0% 99%)` | `--background`, `--shell-canvas` |
| Sidebar and bars | `hsl(225 5% 9%)` | `hsl(0 0% 96.5%)` | `--surface`, `--shell-sidebar`, `--shell-bar` |
| Raised panel | `hsl(225 5% 11%)` | white | `--surface-raised`, `--shell-raised` |
| Primary text | `hsl(0 0% 95%)` | `hsl(0 0% 7%)` | `--foreground` |
| Secondary text | `hsl(0 0% 62%)` | `hsl(0 0% 42%)` | `--muted-foreground` |
| Accent | `hsl(252 67% 72%)` | `hsl(252 54% 47%)` | `--primary`, `--ring` |
| Hairline | foreground at 11% | foreground at 11% | `--shell-line` |
| Strong hairline | foreground at 18% | foreground at 18% | `--shell-line-strong` |
| Hover / selection | foreground at 5.5% / 9% | same opacity | `--shell-hover`, `--shell-selected` |

`themes.css` holds the existing warm, cool, and other light and dark variants. Each variant supplies the same `background`, `surface`, `surface-raised`, `foreground`, and `primary` roles. `shell.css` derives the border and interaction tokens, so the component treatment stays consistent as users change theme. Accent is reserved for selection markers, focus rings, and primary actions. Error and progress colors retain their semantic meaning.

## Type, space, and states

- Shell text uses Inter where available, then a close platform sans serif. The terminal and literal paths keep JetBrains Mono. Standard shell text is 13px, compact controls 12px, dialog headings 15px.
- Use a 4px spacing grid. Main header is 44px; rows and tabs are 28–36px. Align icons to the text baseline and keep 16px icons in the controls.
- Use 2–4px radii on controls and 4–8px on panels. No pill shapes for navigation or toolbars.
- A 1px translucent border separates surfaces. Surface elevation is a small luminance step. No background blur, gradient, or drop shadow is needed.
- Hover uses `--shell-hover`, selection uses `--shell-selected`, and keyboard focus uses a 2px `--ring` outline. Disabled controls use reduced opacity. State transitions change color or border in 120–150ms; reduced motion removes them.

## Component rules

| Component | Treatment |
| --- | --- |
| Hamburger and side pane | A 28px square ghost control opens the pane. The pane uses `--shell-sidebar` with one right hairline; the resize handle appears on hover. Mobile uses the same opaque pane and a plain dim scrim. |
| Tab bar | A compact rectangular segmented switch distinguishes Terminal and Files. File tabs share the bar surface and use a 1px accent baseline for the active file. |
| File explorer | Tree rows are 28px on desktop, with one selected fill and a narrow active marker. A flat breadcrumb/filter header uses the same border as the tab bar. |
| Drop and upload | The drop target uses `--shell-accent-tint` and an inset accent line. Upload progress uses a raised solid status panel with an inline progress line. |
| Buttons and controls | Ghost controls stay quiet until hover. Outline controls use a thin border. Only the primary action receives a solid accent fill. |
| Settings panel | A raised, right anchored panel uses a hairline outline, solid header and footer, and dense form controls. |
| Theme selector | The same panel geometry presents every variant in compact rows with a small palette swatch and a single active marker. |

## Implementation

`app/globals.css` imports `styles/themes.css` and `styles/shell.css`. New shell components should use semantic CSS variables rather than fixed theme colors. Tailwind utilities such as `bg-[var(--shell-raised)]`, `border-[var(--shell-line)]`, `rounded-sm`, and `focus-ring` compose the treatments. Legacy `glass*` class names remain as compatibility hooks in `shell.css`; they now resolve to opaque surfaces. The terminal's rendering code is outside this system.
