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

  addEventListener(name: string, listener: (event: any) => void) {
    this.listeners.set(name, listener);
  }
  querySelector() {
    return null;
  }
  removeEventListener(name: string) {
    this.listeners.delete(name);
  }
  dispatchEvent(event: any) {
    this.wheelEvents.push(event);
    return true;
  }
}

test("mobile swipes use terminal wheel input without opening the keyboard", () => {
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
    assert.equal(element.wheelEvents.length, 1);
    assert.equal(
      element.wheelEvents[0].init.deltaMode,
      FakeWheelEvent.DOM_DELTA_LINE
    );
    assert.equal(element.wheelEvents[0].init.deltaY, -1.5);
  } finally {
    cleanup();
    if (originalWheelEvent)
      Object.defineProperty(globalThis, "WheelEvent", originalWheelEvent);
    else Reflect.deleteProperty(globalThis, "WheelEvent");
  }
});
