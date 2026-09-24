import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { AddressInfo } from "node:net";
import test from "node:test";
import { GhosttyCore } from "@wterm/ghostty";

test("the shipped Ghostty core exposes VT state and completes parsed host resources", async (t) => {
  const wasm = await readFile("public/ghostty-vt.wasm");
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/wasm" });
    response.end(wasm);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const core = await GhosttyCore.load({
    wasmPath: `http://127.0.0.1:${address.port}/ghostty-vt.wasm`,
  });
  core.init(80, 24);
  t.after(async () => {
    core.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });

  core.writeString(
    "\x1b[5 q\x1b]12;#123456\x07\x1b]10;#abcdef\x07\x1b]11;#102030\x07\x1b]4;1;#fedcba\x07\x1b[31mX\x1b]0;WTerm title\x07"
  );
  assert.equal(core.getCursorStyle(), "bar");
  assert.equal(core.cursorBlinking(), true);
  assert.equal(core.getCursorColor(), 0x123456);
  assert.deepEqual(core.getTerminalColors(), {
    foreground: 0xabcdef,
    background: 0x102030,
  });
  assert.equal(core.getCell(0, 0).fgRgb, 0xfedcba);
  assert.equal(core.getTitle(), "WTerm title");

  core.writeString("\x1bP+q5745524D5F55524C5F494D414745;534D554C58\x1b\\");
  assert.equal(
    core.getResponse(),
    "\x1bP1+r5745524D5F55524C5F494D414745=31\x1b\\"
  );
  assert.equal(core.getResponse(), "\x1bP0+r534D554C58\x1b\\");

  core.setDefaultColors(0x010203, 0x040506);
  assert.deepEqual(core.getTerminalColors(), {
    foreground: 0xabcdef,
    background: 0x102030,
  });
  core.writeString("\x1b]110\x07\x1b]111\x07\x1b]112\x07");
  assert.deepEqual(core.getTerminalColors(), {
    foreground: 0x010203,
    background: 0x040506,
  });
  assert.equal(core.getCursorColor(), null);

  const encodedPath = Buffer.from("/tmp/resource.png").toString("base64");
  core.writeString(`\x1b_Ga=T,t=f,f=24,s=1,v=1,i=88;${encodedPath}\x1b\\`);
  const [fileRequest] = core.drainResourceRequests();
  assert.equal(fileRequest?.transport, "file");
  assert.equal(fileRequest?.source, "/tmp/resource.png");
  assert.ok(fileRequest);
  assert.equal(
    core.completeResourceRequest(fileRequest.id, new Uint8Array([255, 0, 32])),
    true
  );
  assert.equal(core.getResponse(), "\x1b_Gi=88;OK\x1b\\");
  const graphics = core.getGraphicsState();
  assert.deepEqual(
    core.getGraphicsImage(88, graphics!.images[0]!.version)?.rgba,
    new Uint8Array([255, 0, 32, 255])
  );

  const encodedUrl = Buffer.from("https://images.example/image.png").toString(
    "base64"
  );
  core.writeString(`\x1b_Ga=T,t=u,f=100,i=89;${encodedUrl}\x1b\\`);
  const [urlRequest] = core.drainResourceRequests();
  assert.equal(urlRequest?.transport, "url");
  assert.equal(urlRequest?.source, "https://images.example/image.png");
  assert.ok(urlRequest);
  assert.equal(core.rejectResourceRequest(urlRequest.id), true);
  assert.match(core.getResponse() ?? "", /i=89;EINVAL/u);

  const encodedSharedName =
    Buffer.from("shared-memory-name").toString("base64");
  core.writeString(
    `\x1b_Ga=T,t=s,f=24,s=1,v=1,i=90;${encodedSharedName}\x1b\\`
  );
  assert.match(
    core.getResponse() ?? "",
    /i=90;EINVAL: shared memory transport unsupported/u
  );
});
