import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, timingSafeEqual } from "node:crypto";

const UPSTREAM = "https://api.telegram.org";

// Only Bot API methods and file downloads, so the relay can't reach anything else.
const BOT_PATH = /^\/(file\/)?bot\d+:[A-Za-z0-9_-]+\/[^?#]+$/;

const TOKENS = [process.env.RELAY_TOKEN, ...(process.env.RELAY_TOKENS || "").split(",")]
  .map((t) => (t || "").trim())
  .filter(Boolean)
  .map(sha256);

// fetch() has already decoded the body, so these upstream headers no longer
// describe what we stream back.
const STRIP = new Set(["content-encoding", "content-length", "transfer-encoding", "connection"]);

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

function authorized(token) {
  if (!token) return false;
  const digest = sha256(token);
  let ok = false;
  for (const known of TOKENS) ok = timingSafeEqual(digest, known) || ok;
  return ok;
}

function forwarded(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (key === "content-type" || key === "accept") out[key] = value;
  }
  return out;
}

function reject(responseStream, statusCode, error) {
  const out = awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers: { "content-type": "application/json" },
  });
  out.write(JSON.stringify({ ok: false, error }));
  out.end();
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const headers = event.headers || {};
  if (!authorized(headers["x-relay-token"])) return reject(responseStream, 403, "forbidden");

  const qs = event.rawQueryString ? `?${event.rawQueryString}` : "";
  // Check after URL normalization: "/bot.../../x" or "//other.host/..." must not get through.
  const target = new URL((event.rawPath || "/") + qs, UPSTREAM);
  if (target.origin !== UPSTREAM || !BOT_PATH.test(target.pathname)) {
    return reject(responseStream, 404, "not found");
  }

  const method = event.requestContext.http.method;
  const body =
    method === "GET" || method === "HEAD" || event.body == null
      ? undefined
      : event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body;

  const upstream = await fetch(target, { method, headers: forwarded(headers), body });

  const respHeaders = {};
  upstream.headers.forEach((value, name) => {
    if (!STRIP.has(name.toLowerCase())) respHeaders[name] = value;
  });
  const out = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: upstream.status,
    headers: respHeaders,
  });
  if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), out);
  else out.end();
});
