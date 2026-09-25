import assert from "node:assert/strict";
import { test } from "node:test";
import { keepMobileBackspaceRepeating } from "./keyboard-input";

function keyboardEvent(type: string, key: string): KeyboardEvent {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, "key", { value: key });
  return event as KeyboardEvent;
}

function beforeInput(inputType: string): InputEvent {
  const event = new Event("beforeinput", { cancelable: true });
  Object.defineProperty(event, "inputType", { value: inputType });
  return event as InputEvent;
}

test("mobile Backspace pairs a delayed beforeinput with its keydown", async () => {
  const textarea = new EventTarget() as HTMLTextAreaElement;
  textarea.value = "";
  textarea.setSelectionRange = () => {};
  const element = {
    querySelector: () => textarea,
  } as unknown as HTMLElement;
  const sent: string[] = [];
  const cleanup = keepMobileBackspaceRepeating(element, () =>
    sent.push("\x7f")
  );
  let wtermKeydowns = 0;
  textarea.addEventListener("keydown", () => wtermKeydowns++);
  try {
    textarea.dispatchEvent(keyboardEvent("keydown", "Backspace"));
    assert.deepEqual(sent, ["\x7f"]);
    await new Promise((resolve) => setTimeout(resolve, 1));
    textarea.dispatchEvent(beforeInput("deleteContentBackward"));
    assert.deepEqual(sent, ["\x7f"]);
    for (let i = 0; i < 2; i += 1)
      textarea.dispatchEvent(beforeInput("deleteContentBackward"));
    await new Promise((resolve) => setTimeout(resolve, 1));
    assert.deepEqual(sent, ["\x7f", "\x7f", "\x7f"]);
    assert.equal(wtermKeydowns, 0);
    assert.equal(textarea.value, " ");

    textarea.dispatchEvent(beforeInput("insertText"));
    assert.equal(textarea.value, "");
    textarea.value = "x";
    textarea.dispatchEvent(new Event("input"));
    assert.equal(textarea.value, "x");
  } finally {
    cleanup();
  }
});

test("hardware Backspace keydowns each send one delete without beforeinput", async () => {
  const textarea = new EventTarget() as HTMLTextAreaElement;
  textarea.value = "";
  textarea.setSelectionRange = () => {};
  const element = { querySelector: () => textarea } as unknown as HTMLElement;
  let count = 0;
  const cleanup = keepMobileBackspaceRepeating(element, () => count++);
  try {
    textarea.dispatchEvent(keyboardEvent("keydown", "Backspace"));
    textarea.dispatchEvent(keyboardEvent("keydown", "Backspace"));
    await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(count, 2);
    assert.equal(textarea.value, " ");
  } finally {
    cleanup();
  }
});
