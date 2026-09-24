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

test("null RequestInit body is truly bodyless even with a form Content-Type", async () => {
  for (const body of [undefined, null]) {
    const req = request({
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    assert.equal(req.body, null);
    assert.equal(await req.clone().text(), "");
    await expectPass(guardJsonContent, req);
  }
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
  const req = request({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "action=delete",
  });

  // Fetch does not add Content-Length to this Request object. The non-null
  // body stream, not that optional transport header, is the payload signal.
  assert.equal(req.headers.get("content-length"), null);
  assert.notEqual(req.body, null);
  await expectStatus(guardJsonContent, req, 415);
});

test("even an empty-string payload has a body stream and needs JSON", async () => {
  const req = request({ method: "POST", body: "" });
  assert.notEqual(req.body, null);
  await expectStatus(guardJsonContent, req, 415);
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

test("same-origin Host and proxy fallback case matrix", async () => {
  const cases: Array<{
    name: string;
    headers: Record<string, string>;
    status: "pass" | 403;
  }> = [
    {
      name: "no Origin (native client)",
      headers: { host: "cliweb.example.com" },
      status: "pass",
    },
    {
      name: "same-origin Host",
      headers: {
        origin: "https://cliweb.example.com",
        host: "cliweb.example.com",
      },
      status: "pass",
    },
    {
      name: "Host comparison is case-insensitive",
      headers: {
        origin: "https://cliweb.example.com",
        host: "CLIWEB.EXAMPLE.COM",
      },
      status: "pass",
    },
    {
      name: "cross-origin browser through correctly configured proxy",
      headers: {
        origin: "https://evil.example",
        host: "internal-upstream",
        "x-forwarded-host": "cliweb.example.com",
      },
      status: 403,
    },
    {
      name: "proxy-rewritten Host with public forwarded host",
      headers: {
        origin: "https://cliweb.example.com",
        host: "internal-upstream",
        "x-forwarded-host": "cliweb.example.com",
      },
      status: "pass",
    },
    {
      name: "mismatched Host without proxy header",
      headers: {
        origin: "https://cliweb.example.com",
        host: "internal-upstream",
      },
      status: 403,
    },
    {
      name: "invalid Origin",
      headers: { origin: "not a URL", host: "cliweb.example.com" },
      status: 403,
    },
    {
      // A raw client controls both values and therefore passes. It has no
      // browser-managed ambient credentials, so this is outside CSRF's threat
      // model. Proxies must overwrite inbound X-Forwarded-Host regardless.
      name: "direct client spoofs Origin and X-Forwarded-Host together",
      headers: {
        origin: "https://evil.example",
        host: "internal-upstream",
        "x-forwarded-host": "evil.example",
      },
      status: "pass",
    },
  ];

  for (const entry of cases) {
    const req = request({ method: "DELETE", headers: entry.headers });
    if (entry.status === "pass") {
      await expectPass(guardSameOrigin, req);
    } else {
      await expectStatus(guardSameOrigin, req, entry.status);
    }
  }
});

test("first X-Forwarded-Host value wins in a chained proxy", async () => {
  await expectPass(
    guardSameOrigin,
    request({
      method: "DELETE",
      headers: {
        origin: "https://cliweb.example.com",
        host: "internal-upstream",
        "x-forwarded-host": "cliweb.example.com, outer-proxy",
      },
    })
  );
});
