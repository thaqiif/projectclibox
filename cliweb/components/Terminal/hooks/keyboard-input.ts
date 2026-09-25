"use client";

/**
 * Keeps WTerm's hidden keyboard textarea inside the visible terminal.
 *
 * WTerm parks the textarea at `left: -9999px; top: 0` of its scroll surface.
 * Mobile browsers scroll a focused field into view on focus and on every
 * keystroke, so a field outside the visible area drags the terminal (or the
 * whole page) around while typing. Pinned to the top-left of what is on
 * screen, there is nothing to reveal. 16px text also stops iOS from zooming
 * the page into the field on focus.
 */
export function keepKeyboardInputInView(element: HTMLElement): () => void {
  const textarea =
    element.querySelector<HTMLTextAreaElement>(":scope > textarea");
  if (!textarea) return () => {};

  textarea.style.left = "0px";
  textarea.style.fontSize = "16px";
  const place = () => {
    textarea.style.top = `${element.scrollTop}px`;
  };
  place();
  element.addEventListener("scroll", place, { passive: true });
  return () => element.removeEventListener("scroll", place);
}
