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

function createPan(screen: ReturnType<typeof createScreen>) {
  const sent: number[] = [];
  const frames: Array<(time: number) => void> = [];
  const pan = createTuiPan({
    element: screen.element as unknown as HTMLElement,
    sendWheel: (lines) => sent.push(lines),
    requestFrame: (callback) => frames.push(callback),
    cancelFrame: () => {},
  });
  const runFrames = (from: number, count: number) => {
    for (let i = 0; i < count && frames.length; i += 1) {
      frames.shift()!(from + i * 16);
    }
  };
  return { pan, sent, frames, runFrames };
}

const offsetOf = (style: Record<string, string>) =>
  Number(/translate3d\(0, (-?[\d.]+)px/.exec(style.transform ?? "")?.[1] ?? 0);

const history = Array.from({ length: 400 }, (_, i) => `line ${i}`);
const view = (top: number) => history.slice(top, top + 8);
/** tmux copy mode: `position` lines up from a live screen showing `live`. */
const copyView = (live: number, position: number, total: number) => {
  const lines = view(live - position);
  lines[0] = `${lines[0]}          [${position}/${total}]`;
  return lines;
};

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

test("tmux copy mode: the view follows the finger between line redraws", () => {
  const screen = createScreen(view(300));
  const { pan, sent } = createPan(screen);
  try {
    pan.begin(ROW);
    pan.move(10); // half a row towards older output: ask for one line
    assert.deepEqual(sent, [1]);
    assert.equal(offsetOf(screen.grid.style), 8); // capped until tmux answers

    screen.show(copyView(300, 1, 300)); // entered copy mode, one line up
    pan.handleRedraw();
    // The line landed: the view now sits half a row past the finger.
    assert.equal(offsetOf(screen.grid.style), -10);

    pan.move(10);
    assert.equal(screen.grid.style.transform, "");
  } finally {
    pan.dispose();
  }
});

test("tmux copy mode: the top of the history stops the view dead", () => {
  const screen = createScreen(copyView(300, 298, 300));
  const { pan, sent } = createPan(screen);
  try {
    pan.begin(ROW);
    pan.move(30); // 1.5 rows, but only two lines are left
    assert.deepEqual(sent, [2]);
    screen.show(copyView(300, 300, 300));
    pan.handleRedraw();
    assert.equal(offsetOf(screen.grid.style), -10);

    pan.move(200); // pulling past the top neither moves nor asks for more
    assert.deepEqual(sent, [2]);
    assert.equal(screen.grid.style.transform, "");
    pan.move(-5); // reversing responds at once
    assert.equal(offsetOf(screen.grid.style), -5);
  } finally {
    pan.dispose();
  }
});

test("tmux: the live screen has nothing newer to scroll to", () => {
  const screen = createScreen(view(300));
  const { pan, sent } = createPan(screen);
  try {
    pan.begin(ROW);
    pan.move(-40);
    // Only single-line probes (in case output arrived), and no movement.
    assert.ok(sent.every((lines) => lines === -1));
    assert.equal(screen.grid.style.transform ?? "", "");
  } finally {
    pan.dispose();
  }
});

test("a fling glides onto a whole row inside the history", () => {
  const screen = createScreen(copyView(300, 290, 300));
  const { pan, sent, runFrames } = createPan(screen);
  try {
    pan.begin(ROW);
    // A hard fling towards older output that would overshoot the top.
    pan.fling(2);
    runFrames(0, 200);
    // It asked for exactly the ten lines that exist, never more.
    assert.equal(
      sent.reduce((sum, lines) => sum + lines, 0),
      10
    );
  } finally {
    pan.dispose();
  }
});

test("apps that scroll several lines per report: one report until learnt", () => {
  const screen = createScreen(view(20));
  const { pan, sent } = createPan(screen);
  try {
    pan.begin(ROW);
    pan.move(10);
    pan.move(30); // more travel, but the first step is still unanswered
    assert.deepEqual(sent, [1]);

    screen.show(view(17)); // one report moved three lines
    pan.handleRedraw();
    // 40px travelled, content moved 60px: the view waits for the finger.
    assert.equal(offsetOf(screen.grid.style), -20);
    pan.move(20); // 60px: level with the content, no new report yet
    assert.deepEqual(sent, [1]);
    assert.equal(screen.grid.style.transform, "");
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
  const { pan } = createPan(screen);
  try {
    pan.begin(ROW);
    pan.move(10);
    screen.show(frame(19));
    pan.handleRedraw();
    pan.move(6); // 16px travelled, content moved 20px: -4px offset
    assert.equal(screen.grid.style.transform, "");
    assert.equal(screen.rows[0].style.transform ?? "", "");
    assert.equal(screen.rows[7].style.transform ?? "", "");
    assert.equal(offsetOf(screen.rows[3].style), -4);
    // The top band row is clipped so it does not paint over the header.
    assert.equal(screen.rows[1].style.clipPath, "inset(4px 0 0px 0)");
  } finally {
    pan.dispose();
  }
});

test("an app that stops redrawing marks an end without a big bounce", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const screen = createScreen(view(0));
  const { pan, sent } = createPan(screen);
  try {
    pan.begin(ROW);
    pan.move(10);
    pan.move(10);
    assert.deepEqual(sent, [1]);
    // Unproven direction: the view runs ahead at most 0.4 of a row.
    assert.equal(offsetOf(screen.grid.style), 8);
    mock.timers.tick(400); // no redraw: already at the top
    assert.equal(screen.grid.style.transform, "");

    pan.move(15); // further pulls do not move the view
    assert.equal(screen.grid.style.transform ?? "", "");
    pan.move(-8); // reversing responds immediately
    assert.equal(offsetOf(screen.grid.style), -8);
  } finally {
    pan.dispose();
    mock.timers.reset();
  }
});
