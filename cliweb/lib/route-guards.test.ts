/**
 * Regression tests for lib/route-guards.ts, driven with real Request
 * objects so body/origin/header semantics match what Next receives.
 * Born from a break: guards were added to the terminal routes and a
 * bodyless DELETE fetch failed the Content-Type check with 415.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  guardJsonContent,
  guardSameOrigin,
  guardJsonSameOrigin,
} from "./route-guards";

type Guard = (request: Request) => unknown;
type MaybeResponse = { status?: number } | null | undefined;

function request(init: RequestInit): Request {
  return new Request("http://localhost/api/terminals/term-x", init);
}

async function expectPass(guard: Guard, req: Request) {
  const res = guard(req) as MaybeResponse;
  assert.ok(res == null, `expected ${guard.name} to pass, got ${res?.status}`);
}

async function expectStatus(guard: Guard, req: Request, expected: number) {
  const res = guard(req) as MaybeResponse;
  assert.equal(res?.status, expected, `expected ${guard.name} to reject`);
}

test("bodyless DELETE without Content-Type passes the JSON guard", async () => {
  // The client's kill fetch: a bare DELETE with no headers and no body.
  await expectPass(guardJsonContent, request({ method: "DELETE" }));
  await expectPass(
    guardJsonSameOrigin,
    request({
      method: "DELETE",
      headers: { origin: "http://localhost", host: "localhost" },
    })
  );
});

test("bodyless GET passes the JSON guard the same way", async () => {
  await expectPass(guardJsonContent, request({ method: "GET" }));
});

test("a request with a JSON body still passes the JSON guard", async () => {
  await expectPass(
    guardJsonContent,
    request({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp" }),
    })
  );
});

test("a request with a body but wrong Content-Type is still rejected", async () => {
  await expectStatus(
    guardJsonContent,
    request({
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "evil",
    }),
    415
  );
});

test("bodyless DELETE with a wrong Origin is still rejected 403", async () => {
  // Dropping the Content-Type check must not weaken the CSRF tripwire.
  await expectStatus(
    guardJsonSameOrigin,
    request({
      method: "DELETE",
      headers: { origin: "http://evil.example", host: "localhost" },
    }),
    403
  );
});

test("same-origin guard requires Origin to equal Host", async () => {
  await expectStatus(
    guardSameOrigin,
    request({
      method: "DELETE",
      headers: { origin: "http://localhost", host: "otherhost" },
    }),
    403
  );
  await expectPass(
    guardSameOrigin,
    request({
      method: "DELETE",
      headers: { origin: "http://localhost", host: "localhost" },
    })
  );
});
