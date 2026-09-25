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

/**
 * Keep a deletable cell in WTerm's hidden textarea while Backspace is held.
 * iOS sends repeated deleteContentBackward input events only while the field
 * has content. WTerm normally empties it after every character, which leaves
 * the first keydown as the only deletion the terminal receives.
 */
export function keepMobileBackspaceRepeating(
  element: HTMLElement,
  onBackspace: () => void
): () => void {
  const textarea =
    element.querySelector<HTMLTextAreaElement>(":scope > textarea");
  if (!textarea) return () => {};
  let fallback: ReturnType<typeof setTimeout> | null = null;

  const arm = () => {
    if (textarea.value !== "") return;
    textarea.value = " ";
    textarea.setSelectionRange(1, 1);
  };
  const clearFallback = () => {
    if (fallback !== null) clearTimeout(fallback);
    fallback = null;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Backspace") return;
    // Let the browser emit beforeinput, while keeping WTerm's keydown path
    // from sending the same deletion a second time.
    event.stopImmediatePropagation();
    arm();
    clearFallback();
    // Hardware keyboards that do not issue beforeinput still delete once
    // per (possibly repeated) keydown.
    fallback = setTimeout(() => {
      fallback = null;
      onBackspace();
      arm();
    }, 0);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Backspace") event.stopImmediatePropagation();
  };
  const onBeforeInput = (event: InputEvent) => {
    if (event.inputType === "deleteContentBackward") {
      clearFallback();
      if (event.cancelable) event.preventDefault();
      onBackspace();
      queueMicrotask(arm);
    } else if (textarea.value === " ") {
      // Let WTerm's input handler see only newly typed text.
      textarea.value = "";
    }
  };
  const onInput = () => {
    if (textarea.value.startsWith(" ")) {
      textarea.value = textarea.value.slice(1);
    }
  };
  const onBlur = () => {
    clearFallback();
    textarea.value = "";
  };

  textarea.addEventListener("keydown", onKeyDown, true);
  textarea.addEventListener("keyup", onKeyUp, true);
  textarea.addEventListener("beforeinput", onBeforeInput, true);
  textarea.addEventListener("input", onInput, true);
  textarea.addEventListener("blur", onBlur, true);
  return () => {
    clearFallback();
    textarea.removeEventListener("keydown", onKeyDown, true);
    textarea.removeEventListener("keyup", onKeyUp, true);
    textarea.removeEventListener("beforeinput", onBeforeInput, true);
    textarea.removeEventListener("input", onInput, true);
    textarea.removeEventListener("blur", onBlur, true);
    if (textarea.value === " ") textarea.value = "";
  };
}
