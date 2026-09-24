import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createTuiPan, detectScrollShift } from "./tui-pan";

const ROW = 20;

function createScreen(lines: string[]) {
  const rows = lines.map((text) => ({
    textContent: text,
    style: {} as Record<string, string>,
  }));
  const grid = {
    style: {} as Record<string, string>,
    querySelectorAll: () => rows,
  };
  const classes = new Set<string>();
  const element = {
    querySelector: () => grid,
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
  };
  const show = (next: string[]) =>
    next.forEach((text, index) => (rows[index].textContent = text));
  return { rows, grid, element, classes, show };
}

const history = Array.from({ length: 40 }, (_, i) => `line ${i}`);
const view = (top: number) => history.slice(top, top + 8);

test("detects a whole-screen scroll in either direction", () => {
  assert.deepEqual(detectScrollShift(view(10), view(9), 1), {
    rows: 1,
    top: 0,
    bottom: 7,
  });
  assert.deepEqual(detectScrollShift(view(10), view(13), -1), {
    rows: 3,
    top: 0,
    bottom: 7,
  });
  assert.equal(detectScrollShift(view(10), view(10), 1), null);
});

test("detects a chat band scrolling between fixed chrome", () => {
  const frame = (top: number) => [
    "┌ opencode ─┐",
    ...history.slice(top, top + 6),
    "│ > prompt  │",
    "└───────────┘",
  ];
  assert.deepEqual(detectScrollShift(frame(10), frame(7), 1), {
    rows: 3,
    top: 1,
    bottom: 6,
  });
});

test("repeated border lines are not mistaken for a scroll", () => {
  const box = ["│          │", "│          │", "│          │", "│          │"];
  assert.equal(detectScrollShift(box, box, 1), null);
});

test("finger travel between redraws is shown as a pixel offset", () => {
  const screen = createScreen(view(20));
  const sent: number[] = [];
  const pan = createTuiPan({
    element: screen.element as unknown as HTMLElement,
    sendWheel: (lines) => sent.push(lines),
  });
  try {
    pan.begin(ROW);
    pan.move(10); // half a row towards older output: ask for one line
    assert.deepEqual(sent, [1]);
    assert.equal(screen.grid.style.transform, "translate3d(0, 10px, 0)");

    screen.show(view(19));
    pan.handleRedraw();
    // The line landed, so the view now sits half a row past the finger.
    assert.equal(screen.grid.style.transform, "translate3d(0, -10px, 0)");

    pan.move(10);
    assert.equal(screen.grid.style.transform, "");
  } finally {
    pan.dispose();
  }
});

test("TUIs that scroll several lines per wheel report are learnt", () => {
  const screen = createScreen(view(20));
  const sent: number[] = [];
  const pan = createTuiPan({
    element: screen.element as unknown as HTMLElement,
    sendWheel: (lines) => sent.push(lines),
  });
  try {
    pan.begin(ROW);
    pan.move(10);
    screen.show(view(17)); // one report moved three lines
    pan.handleRedraw();
    pan.move(20); // 30px total: still inside the three-line step
    assert.deepEqual(sent, [1]);
    assert.equal(screen.grid.style.transform, "translate3d(0, -30px, 0)");
  } finally {
    pan.dispose();
  }
});

test("only the scrolling band moves; chrome stays still", () => {
  const frame = (top: number) => [
    "┌ opencode ─┐",
    ...history.slice(top, top + 6),
    "│ > prompt  │",
  ];
  const screen = createScreen(frame(20));
  const pan = createTuiPan({
    element: screen.element as unknown as HTMLElement,
    sendWheel: () => {},
  });
  try {
    pan.begin(ROW);
    pan.move(10);
    screen.show(frame(19));
    pan.handleRedraw();
    pan.move(6); // 16px travelled, content moved 20px: -4px offset
    assert.equal(screen.grid.style.transform, "");
    assert.equal(screen.rows[0].style.transform ?? "", "");
    assert.equal(screen.rows[7].style.transform ?? "", "");
    assert.equal(screen.rows[3].style.transform, "translate3d(0, -4px, 0)");
    // The top band row is clipped so it does not paint over the header.
    assert.equal(screen.rows[1].style.clipPath, "inset(4px 0 0px 0)");
  } finally {
    pan.dispose();
  }
});

test("the end of the history stops the view instead of bouncing", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const screen = createScreen(view(0));
  const sent: number[] = [];
  const pan = createTuiPan({
    element: screen.element as unknown as HTMLElement,
    sendWheel: (lines) => sent.push(lines),
  });
  try {
    pan.begin(ROW);
    pan.move(10);
    assert.deepEqual(sent, [1]);
    mock.timers.tick(400); // no redraw: already at the top
    assert.equal(screen.grid.style.transform, "");

    pan.move(15); // further pulls do not move the view at all
    assert.equal(screen.grid.style.transform ?? "", "");
    pan.move(-10); // reversing responds immediately
    assert.equal(screen.grid.style.transform, "translate3d(0, -10px, 0)");
  } finally {
    pan.dispose();
    mock.timers.reset();
  }
});

test("starts at the live bottom, so pulling for newer output does not move", () => {
  const screen = createScreen(view(30));
  const pan = createTuiPan({
    element: screen.element as unknown as HTMLElement,
    sendWheel: () => {},
  });
  try {
    pan.begin(ROW);
    pan.move(-8);
    assert.equal(screen.grid.style.transform ?? "", "");
  } finally {
    pan.dispose();
  }
});
