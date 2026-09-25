import assert from "node:assert/strict";
import { test } from "node:test";
import type { WTerm } from "@wterm/dom";
import type { GhosttyCore } from "@wterm/ghostty";
import { setupTouchScroll } from "./touch-scroll";

class FakeTarget {
  listeners = new Map<string, (event: any) => void>();
  addEventListener(name: string, listener: (event: any) => void) {
    this.listeners.set(name, listener);
  }
  removeEventListener(name: string) {
    this.listeners.delete(name);
  }
}

class FakeTouchElement extends FakeTarget {
  style: Record<string, string> = {};
  wheelEvents: any[] = [];
  scrollTop = 0;
  grid = {
    style: {} as Record<string, string>,
    querySelectorAll: () => [],
  };
  classes = new Set<string>();
  classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };

  querySelector(selector: string) {
    return selector === ".term-grid" ? this.grid : null;
  }
  dispatchEvent(event: any) {
    this.wheelEvents.push(event);
    return true;
  }
}

function withFakeBrowser(
  run: (frames: Array<(time: number) => void>) => void | Promise<void>
): void | Promise<void> {
  const originalWheelEvent = Object.getOwnPropertyDescriptor(
    globalThis,
    "WheelEvent"
  );
  class FakeWheelEvent {
    static DOM_DELTA_PIXEL = 0;
    static DOM_DELTA_LINE = 1;
    constructor(
      readonly type: string,
      readonly init: Record<string, unknown>
    ) {}
  }
  Object.defineProperty(globalThis, "WheelEvent", {
    configurable: true,
    value: FakeWheelEvent,
  });
  const frames: Array<(time: number) => void> = [];
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCaf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: (time: number) => void) =>
    frames.push(cb)) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
  const restore = () => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;
    if (originalWheelEvent)
      Object.defineProperty(globalThis, "WheelEvent", originalWheelEvent);
    else Reflect.deleteProperty(globalThis, "WheelEvent");
  };
  let result: void | Promise<void>;
  try {
    result = run(frames);
  } catch (error) {
    restore();
    throw error;
  }
  if (result instanceof Promise) return result.finally(restore);
  restore();
}

const touch = (clientY: number) => ({
  touches: [{ clientX: 80, clientY }],
  cancelable: true,
  preventDefault() {},
  stopPropagation() {},
});

function setup(
  element: FakeTouchElement,
  requestHistory?: (count: number) => Promise<null>
) {
  let focusCount = 0;
  const terminal = {
    element,
    focus: () => focusCount++,
  } as unknown as WTerm;
  const core = { usingAltScreen: () => true } as unknown as GhosttyCore;
  const cleanup = setupTouchScroll({
    terminal,
    core,
    selectModeRef: { current: false },
    isMobile: true,
    requestHistory,
  });
  return { cleanup, focusCount: () => focusCount };
}

test("mobile swipes pan TUIs pixel by pixel without opening the keyboard", () => {
  withFakeBrowser((frames) => {
    const element = new FakeTouchElement();
    const { cleanup, focusCount } = setup(element);
    try {
      element.listeners.get("touchstart")?.(touch(100));
      element.listeners.get("touchmove")?.(touch(110)); // past the slop
      element.listeners.get("touchmove")?.(touch(140));
      assert.equal(focusCount(), 0);
      // Moves are batched into the next animation frame.
      assert.equal(element.wheelEvents.length, 0);
      frames.shift()?.(16);
      // 30px at the 20px fallback row height: one line-mode wheel event,
      // and only one until the app shows how far a report scrolls.
      assert.equal(element.wheelEvents.length, 1);
      assert.equal(element.wheelEvents[0].init.deltaMode, 1);
      assert.equal(element.wheelEvents[0].init.deltaY, -1);
      // The grid follows the finger, a little, until the redraw lands.
      assert.equal(element.grid.style.transform, "translate3d(0, 8px, 0)");
      assert.ok(element.classes.has("touch-panning"));
    } finally {
      cleanup();
    }
  });
});

test("a swipe keeps working after the touched text is redrawn away", () => {
  withFakeBrowser((frames) => {
    const element = new FakeTouchElement();
    const { cleanup } = setup(element);
    // The finger lands on a span that WTerm will replace on the next
    // redraw. Its later events never bubble to the terminal again.
    const span = new FakeTarget();
    try {
      element.listeners.get("touchstart")?.({ ...touch(100), target: span });
      span.listeners.get("touchmove")?.(touch(110));
      span.listeners.get("touchmove")?.(touch(140));
      frames.shift()?.(16);
      assert.equal(element.wheelEvents.length, 1);
      span.listeners.get("touchend")?.({});
      assert.equal(span.listeners.size, 0);
    } finally {
      cleanup();
    }
  });
});

test("without local history (a full-screen app), travel so far still pans", () =>
  withFakeBrowser(async (frames) => {
    const element = new FakeTouchElement();
    let answer: (value: null) => void = () => {};
    const { cleanup } = setup(
      element,
      () => new Promise<null>((resolve) => (answer = resolve))
    );
    try {
      element.listeners.get("touchstart")?.(touch(100));
      element.listeners.get("touchmove")?.(touch(110));
      element.listeners.get("touchmove")?.(touch(140));
      frames.shift()?.(16);
      // Still waiting for the answer: nothing sent yet.
      assert.equal(element.wheelEvents.length, 0);
      answer(null);
      await new Promise((resolve) => setTimeout(resolve, 0));
      // The 30px travelled while deciding is applied to the pan.
      assert.equal(element.wheelEvents.length, 1);
    } finally {
      cleanup();
    }
  }));
