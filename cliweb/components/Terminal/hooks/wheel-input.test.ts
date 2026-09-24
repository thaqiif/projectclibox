import assert from "node:assert/strict";
import { test } from "node:test";

import { InputHandler as WTermInputHandler } from "../../../node_modules/@wterm/dom/dist/input.js";

const InputHandler = WTermInputHandler as any;

class FakeTextarea {
  style: Record<string, string> = {};
  listeners = new Map<string, () => void>();

  setAttribute() {}
  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, listener);
  }
  removeEventListener(name: string) {
    this.listeners.delete(name);
  }
  remove() {}
}

function createHarness({
  tracking = 0,
  sgr = false,
  altScreen = false,
  scrollHeight = 480,
  scrollbackCount = 0,
}: {
  tracking?: number;
  sgr?: boolean;
  altScreen?: boolean;
  scrollHeight?: number;
  scrollbackCount?: number;
} = {}) {
  const sent: string[] = [];
  const frames: Array<(time: number) => void> = [];
  let now = 0;
  const row = {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  };
  const view = {
    navigator: { platform: "Linux" },
    getComputedStyle: () => ({}),
    performance: { now: () => now },
    requestAnimationFrame: (callback: (time: number) => void) => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {},
  };
  const element = {
    ownerDocument: { defaultView: view },
    style: {},
    classList: { add() {}, remove() {} },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    querySelector: () => row,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 480 }),
    clientWidth: 800,
    clientHeight: 480,
    scrollHeight,
    scrollTop: 0,
  };
  const bridge = {
    mouseTracking: () => tracking,
    mouseSgr: () => sgr,
    usingAltScreen: () => altScreen,
    getCols: () => 80,
    getRows: () => 24,
    getScrollbackCount: () => scrollbackCount,
  };
  const handler = new InputHandler(
    element as unknown as HTMLElement,
    (data: string) => sent.push(data),
    () => bridge,
    () => ({ charWidth: 10, rowHeight: 20 })
  );
  return {
    handler,
    element,
    sent,
    frames,
    setNow(value: number) {
      now = value;
    },
  };
}

function wheel(deltaY: number) {
  return {
    deltaX: 0,
    deltaY,
    deltaMode: 0,
    clientX: 60,
    clientY: 50,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

test("alternate screen without mouse mode maps wheel to Up and Down", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
  const originalWheelEvent = Object.getOwnPropertyDescriptor(
    globalThis,
    "WheelEvent"
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => new FakeTextarea() },
  });
  Object.defineProperty(globalThis, "WheelEvent", {
    configurable: true,
    value: { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
  });

  try {
    const { handler, sent } = createHarness({ altScreen: true });
    const event = wheel(-100);
    handler.handleMouse(event, "wheel");
    assert.deepEqual(sent, ["\x1b[A"]);
    assert.equal(event.defaultPrevented, true);
    handler.destroy();
  } finally {
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalWheelEvent)
      Object.defineProperty(globalThis, "WheelEvent", originalWheelEvent);
    else Reflect.deleteProperty(globalThis, "WheelEvent");
  }
});

test("SGR mouse mode accumulates high-resolution wheel deltas by cell height", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
  const originalWheelEvent = Object.getOwnPropertyDescriptor(
    globalThis,
    "WheelEvent"
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => new FakeTextarea() },
  });
  Object.defineProperty(globalThis, "WheelEvent", {
    configurable: true,
    value: { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
  });

  try {
    const { handler, sent } = createHarness({
      tracking: 1000,
      sgr: true,
      altScreen: true,
    });
    for (let index = 0; index < 3; index++)
      handler.handleMouse(wheel(-20), "wheel");
    assert.deepEqual(sent, []);
    handler.handleMouse(wheel(-20), "wheel");
    assert.deepEqual(sent, ["\x1b[<64;7;3M"]);
    handler.destroy();
  } finally {
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalWheelEvent)
      Object.defineProperty(globalThis, "WheelEvent", originalWheelEvent);
    else Reflect.deleteProperty(globalThis, "WheelEvent");
  }
});

test("normal-buffer wheel scrolling eases over 100ms", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );
  const originalWheelEvent = Object.getOwnPropertyDescriptor(
    globalThis,
    "WheelEvent"
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => new FakeTextarea() },
  });
  Object.defineProperty(globalThis, "WheelEvent", {
    configurable: true,
    value: { DOM_DELTA_PIXEL: 0, DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 },
  });

  try {
    const { handler, element, frames, setNow } = createHarness({
      scrollHeight: 1000,
      scrollbackCount: 20,
    });
    const event = wheel(100);
    handler.handleMouse(event, "wheel");
    assert.equal(event.defaultPrevented, true);
    assert.equal(element.scrollTop, 0);

    setNow(50);
    frames.shift()?.(50);
    assert.ok(element.scrollTop > 0 && element.scrollTop < 100);
    handler.destroy();
  } finally {
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalWheelEvent)
      Object.defineProperty(globalThis, "WheelEvent", originalWheelEvent);
    else Reflect.deleteProperty(globalThis, "WheelEvent");
  }
});
