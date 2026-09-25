"use client";

const activeBackspaceBridges = new WeakMap<HTMLTextAreaElement, () => void>();
const KEYDOWN_FALLBACK_MS = 20;
const KEYDOWN_PAIR_TTL_MS = 1000;

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
  activeBackspaceBridges.get(textarea)?.();
  type PendingKeydown = {
    sent: boolean;
    fallback: ReturnType<typeof setTimeout>;
    expires: ReturnType<typeof setTimeout>;
  };
  const pendingKeydowns: PendingKeydown[] = [];
  let handledDeleteBeforeInput = false;

  const arm = () => {
    if (textarea.value !== "") return;
    textarea.value = " ";
    textarea.setSelectionRange(1, 1);
  };
  const clearKeydowns = () => {
    for (const pending of pendingKeydowns) {
      clearTimeout(pending.fallback);
      clearTimeout(pending.expires);
    }
    pendingKeydowns.length = 0;
  };
  const consumeDelete = () => {
    const pending = pendingKeydowns.shift();
    if (pending) {
      clearTimeout(pending.fallback);
      clearTimeout(pending.expires);
    }
    if (!pending?.sent) onBackspace();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Backspace") {
      handledDeleteBeforeInput = false;
      return;
    }
    // beforeinput is the delete operation on iOS. A hardware keyboard may
    // deliver only keydown; keep its fallback paired with a late beforeinput.
    event.stopImmediatePropagation();
    arm();
    const pending = {} as PendingKeydown;
    pending.sent = false;
    pending.fallback = setTimeout(() => {
      if (pending.sent) return;
      pending.sent = true;
      onBackspace();
    }, KEYDOWN_FALLBACK_MS);
    pending.expires = setTimeout(() => {
      const index = pendingKeydowns.indexOf(pending);
      if (index >= 0) pendingKeydowns.splice(index, 1);
    }, KEYDOWN_PAIR_TTL_MS);
    pendingKeydowns.push(pending);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Backspace") event.stopImmediatePropagation();
  };
  const onBeforeInput = (event: InputEvent) => {
    if (event.inputType === "deleteContentBackward") {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
      handledDeleteBeforeInput = true;
      consumeDelete();
      queueMicrotask(arm);
    } else {
      handledDeleteBeforeInput = false;
      clearKeydowns();
      if (textarea.value === " ") {
        // Let WTerm's input handler see only newly typed text.
        textarea.value = "";
      }
    }
  };
  const onInput = (event: Event) => {
    if (
      (event as InputEvent).inputType === "deleteContentBackward" ||
      handledDeleteBeforeInput
    ) {
      // iOS can still dispatch input when beforeinput was not cancelable.
      // WTerm forwards any remaining textarea value as typed terminal data.
      event.stopImmediatePropagation();
      if (!handledDeleteBeforeInput) consumeDelete();
      handledDeleteBeforeInput = false;
      textarea.value = "";
      queueMicrotask(arm);
      return;
    }
    if (textarea.value.startsWith(" ")) {
      textarea.value = textarea.value.slice(1);
    }
  };
  const onBlur = () => {
    clearKeydowns();
    handledDeleteBeforeInput = false;
    textarea.value = "";
  };

  textarea.addEventListener("keydown", onKeyDown, true);
  textarea.addEventListener("keyup", onKeyUp, true);
  textarea.addEventListener("beforeinput", onBeforeInput, true);
  textarea.addEventListener("input", onInput, true);
  textarea.addEventListener("blur", onBlur, true);
  const cleanup = () => {
    clearKeydowns();
    if (activeBackspaceBridges.get(textarea) === cleanup)
      activeBackspaceBridges.delete(textarea);
    textarea.removeEventListener("keydown", onKeyDown, true);
    textarea.removeEventListener("keyup", onKeyUp, true);
    textarea.removeEventListener("beforeinput", onBeforeInput, true);
    textarea.removeEventListener("input", onInput, true);
    textarea.removeEventListener("blur", onBlur, true);
    if (textarea.value === " ") textarea.value = "";
  };
  activeBackspaceBridges.set(textarea, cleanup);
  return cleanup;
}
