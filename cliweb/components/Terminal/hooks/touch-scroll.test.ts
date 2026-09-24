import assert from "node:assert/strict";
import { test } from "node:test";
import type { WTerm } from "@wterm/dom";
import type { GhosttyCore } from "@wterm/ghostty";
import { setupTouchScroll } from "./touch-scroll";

class FakeTouchElement {
  style: Record<string, string> = {};
  listeners = new Map<string, (event: any) => void>();
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

  addEventListener(name: string, listener: (event: any) => void) {
    this.listeners.set(name, listener);
  }
  querySelector(selector: string) {
    return selector === ".term-grid" ? this.grid : null;
  }
  removeEventListener(name: string) {
    this.listeners.delete(name);
  }
  dispatchEvent(event: any) {
    this.wheelEvents.push(event);
    return true;
  }
}

test("mobile swipes pan TUIs pixel by pixel without opening the keyboard", () => {
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

  let notifyRedraw = () => {};
  const originalObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor(callback: () => void) {
      notifyRedraw = callback;
    }
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;

  const element = new FakeTouchElement();
  let focusCount = 0;
  const terminal = {
    element,
    focus: () => focusCount++,
  } as unknown as WTerm;
  const core = {
    usingAltScreen: () => true,
  } as unknown as GhosttyCore;
  const cleanup = setupTouchScroll({
    terminal,
    core,
    selectModeRef: { current: false },
    isMobile: true,
  });

  try {
    element.listeners.get("touchstart")?.({
      touches: [{ clientX: 80, clientY: 100 }],
    });
    assert.equal(focusCount, 0);

    element.listeners.get("touchmove")?.({
      touches: [{ clientX: 80, clientY: 130 }],
      preventDefault() {},
      stopPropagation() {},
    });
    assert.equal(focusCount, 0);
    // Moves are batched into the next animation frame.
    assert.equal(element.wheelEvents.length, 0);
    frames.shift()?.(16);
    assert.equal(element.wheelEvents.length, 1);
    // 30px at the 20px fallback row height asks tmux for two lines (each
    // step is requested halfway through), and the grid follows the finger
    // up to three quarters of a row until the redraw lands.
    assert.equal(
      element.wheelEvents[0].init.deltaMode,
      FakeWheelEvent.DOM_DELTA_LINE
    );
    assert.equal(element.wheelEvents[0].init.deltaY, -2);
    assert.equal(element.grid.style.transform, "translate3d(0, 15px, 0)");
    assert.ok(element.classes.has("touch-panning"));
  } finally {
    cleanup();
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;
    globalThis.MutationObserver = originalObserver;
    if (originalWheelEvent)
      Object.defineProperty(globalThis, "WheelEvent", originalWheelEvent);
    else Reflect.deleteProperty(globalThis, "WheelEvent");
  }
});
