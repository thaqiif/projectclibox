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
    assert.deepEqual(sent, []);
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
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(count, 2);
    assert.equal(textarea.value, " ");
  } finally {
    cleanup();
  }
});

test("a second bridge replaces the first on the same textarea", async () => {
  const textarea = new EventTarget() as HTMLTextAreaElement;
  textarea.value = "";
  textarea.setSelectionRange = () => {};
  const element = { querySelector: () => textarea } as unknown as HTMLElement;
  let count = 0;
  const firstCleanup = keepMobileBackspaceRepeating(element, () => count++);
  const secondCleanup = keepMobileBackspaceRepeating(element, () => count++);
  try {
    textarea.dispatchEvent(keyboardEvent("keydown", "Backspace"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(count, 1);
  } finally {
    firstCleanup();
    secondCleanup();
  }
});

test("a late beforeinput cannot repeat a keydown fallback", async () => {
  const textarea = new EventTarget() as HTMLTextAreaElement;
  textarea.value = "";
  textarea.setSelectionRange = () => {};
  const element = { querySelector: () => textarea } as unknown as HTMLElement;
  let count = 0;
  const cleanup = keepMobileBackspaceRepeating(element, () => count++);
  try {
    textarea.dispatchEvent(keyboardEvent("keydown", "Backspace"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(count, 1);
    textarea.dispatchEvent(beforeInput("deleteContentBackward"));
    assert.equal(count, 1);
    textarea.dispatchEvent(beforeInput("deleteContentBackward"));
    assert.equal(count, 2);
  } finally {
    cleanup();
  }
});

test("a noncancelable iOS delete input does not reach WTerm", async () => {
  const textarea = new EventTarget() as HTMLTextAreaElement;
  textarea.value = "";
  textarea.setSelectionRange = () => {};
  const element = { querySelector: () => textarea } as unknown as HTMLElement;
  let deletes = 0;
  let wtermInputs = 0;
  const cleanup = keepMobileBackspaceRepeating(element, () => deletes++);
  textarea.addEventListener("input", () => wtermInputs++);
  try {
    textarea.dispatchEvent(keyboardEvent("keydown", "Backspace"));
    const deletion = new Event("beforeinput", { cancelable: false });
    Object.defineProperty(deletion, "inputType", {
      value: "deleteContentBackward",
    });
    textarea.dispatchEvent(deletion);
    textarea.value = "stale";
    const input = new Event("input");
    Object.defineProperty(input, "inputType", {
      value: "deleteContentBackward",
    });
    textarea.dispatchEvent(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(deletes, 1);
    assert.equal(wtermInputs, 0);
    assert.equal(textarea.value, " ");
  } finally {
    cleanup();
  }
});
