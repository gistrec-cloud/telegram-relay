import { test } from "node:test";
import assert from "node:assert/strict";
import { invoke } from "./harness.mjs";

const { handler } = await import("../index.mjs");
const auth = { "x-relay-token": "alpha" };

test("rejects requests without a valid relay token", async () => {
  assert.equal((await invoke(handler, { path: "/bot1:A/getMe" })).status, 403);
  const wrong = await invoke(handler, { headers: { "x-relay-token": "nope" }, path: "/bot1:A/getMe" });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.upstream, undefined);
});

test("accepts RELAY_TOKEN and every token in RELAY_TOKENS", async () => {
  for (const token of ["legacy", "alpha", "beta"]) {
    const res = await invoke(handler, { headers: { "x-relay-token": token }, path: "/bot1:A/getMe" });
    assert.equal(res.status, 200, token);
  }
});

test("forwards Bot API methods with the query string", async () => {
  const res = await invoke(handler, { headers: auth, path: "/bot123:AA-b_c/getUpdates", query: "offset=5&timeout=25" });
  assert.equal(String(res.upstream.url), "https://api.telegram.org/bot123:AA-b_c/getUpdates?offset=5&timeout=25");
});

test("forwards file downloads", async () => {
  const res = await invoke(handler, { headers: auth, path: "/file/bot123:AA/photos/file_1.jpg" });
  assert.equal(String(res.upstream.url), "https://api.telegram.org/file/bot123:AA/photos/file_1.jpg");
});

test("refuses anything that is not a Bot API path", async () => {
  for (const path of ["/", "/evil", "/bot/getMe", "/botX:Y/getMe", "/bot1:A/", "/bot1:A/../../evil", "/bot1:A/%2e%2e/%2E%2E/evil", "//evil.example/bot1:A/getMe"]) {
    const res = await invoke(handler, { headers: auth, path });
    assert.equal(res.status, 404, path);
    assert.equal(res.upstream, undefined, path);
  }
});

test("decodes base64 bodies and forwards only content headers", async () => {
  const res = await invoke(handler, {
    headers: { ...auth, "content-type": "application/json", cookie: "c" },
    path: "/bot1:A/sendMessage",
    method: "POST",
    body: Buffer.from('{"chat_id":1}').toString("base64"),
    base64: true,
  });
  assert.deepEqual(res.upstream.headers, { "content-type": "application/json" });
  assert.equal(res.upstream.body.toString(), '{"chat_id":1}');
});
