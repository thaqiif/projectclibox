import assert from "node:assert/strict";
import { test } from "node:test";
import { ansiLineToHtml } from "./ansi-html";
import { openHistoryView, historyViewFor } from "./history-view";

test("ANSI colours become spans in the terminal's own palette", () => {
  assert.equal(ansiLineToHtml("plain <b>"), "plain &lt;b&gt;");
  const html = ansiLineToHtml("\x1b[01;32mgreen\x1b[0m rest");
  assert.match(
    html,
    /^<span style="color:var\(--term-core-color-2, var\(--term-color-2\)\);font-weight:bold">green<\/span> rest$/
  );
  assert.match(ansiLineToHtml("\x1b[38;2;1;2;3mx"), /rgb\(1,2,3\)/);
  assert.match(
    ansiLineToHtml("\x1b[7minv"),
    /color:var\(--term-bg\);background:var\(--term-fg\)/
  );
});

class FakeElement {
  children: FakeElement[] = [];
  style: Record<string, string> = {};
  className = "";
  innerHTML = "";
  offsetTop = 0;
  offsetLeft = 0;
  clientWidth = 300;
  ownerDocument = { createElement: () => new FakeElement() };
  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }
  remove() {}
  querySelector() {
    return this;
  }
}

function setup(lines: number, height = 5) {
  const element = new FakeElement();
  const page = {
    lines: Array.from({ length: lines }, (_, i) => `line ${i}`),
    height,
    historySize: lines - height,
  };
  const view = openHistoryView(element as unknown as HTMLElement, page, 10)!;
  const rows = () => element.children[0].children[0];
  const shownTexts = () =>
    rows()
      .children.filter((row) => row.style.top !== "-100000px")
      .map((row) => row.innerHTML);
  const top = () =>
    0 - Number(/translate3d\(0, (-?[\d.]+)px/.exec(rows().style.transform)![1]);
  return { element, view, page, shownTexts, top };
}

test("opens on the live screen and only renders rows near the view", () => {
  const { view, shownTexts, top } = setup(1000);
  assert.ok(view.atLive());
  assert.equal(top(), 995 * 10); // the last screen of lines
  // One screen either side of the five visible rows, not all 1000.
  assert.ok(shownTexts().length <= 15);
  assert.ok(shownTexts().includes("line 999"));
});

test("scrolls locally, stops dead at the oldest line", () => {
  const { view, top } = setup(100);
  view.move(250);
  assert.equal(top(), 950 - 250);
  view.move(1e6);
  assert.equal(top() + 0, 0);
  view.move(-1e6);
  assert.ok(view.atLive());
});

test("a refresh with new output keeps the same text in view", () => {
  const { view, page, top } = setup(100);
  view.move(200);
  const before = top();
  view.replace({
    lines: [...page.lines, "new 1", "new 2"],
    height: page.height,
    historySize: page.historySize + 2,
  });
  // Two lines were added below; the view followed them.
  assert.equal(top(), before);
});

test("closing removes the view", () => {
  const { element, view } = setup(10);
  assert.equal(historyViewFor(element as unknown as HTMLElement), view);
  view.close();
  assert.equal(historyViewFor(element as unknown as HTMLElement), null);
});
