import { Writable } from "node:stream";

export const calls = [];

globalThis.awslambda = {
  streamifyResponse: (fn) => fn,
  HttpResponseStream: {
    from: (stream, meta) => {
      stream.meta = meta;
      // The real runtime only emits the status/headers prelude from write(),
      // so end(chunk) produces a 502. Fail loudly if the handler does that.
      const end = stream.end.bind(stream);
      stream.end = (chunk, ...rest) => {
        if (chunk !== undefined && typeof chunk !== "function") {
          throw new Error("use write(chunk) then end() on a Lambda response stream");
        }
        return end(chunk, ...rest);
      };
      return stream;
    },
  },
};

globalThis.fetch = async (url, init) => {
  calls.push({ url, ...init });
  return new Response('{"ok":true}', {
    status: 200,
    headers: { "content-type": "application/json", "content-length": "11", "x-upstream": "1" },
  });
};

process.env.RELAY_TOKEN = "legacy";
process.env.RELAY_TOKENS = "alpha, beta";

export async function invoke(handler, { headers = {}, path = "/", query = "", method = "GET", body, base64 = false } = {}) {
  calls.length = 0;
  const chunks = [];
  const stream = new Writable({
    write(chunk, _, done) {
      chunks.push(chunk);
      done();
    },
  });
  await handler(
    { headers, rawPath: path, rawQueryString: query, body, isBase64Encoded: base64, requestContext: { http: { method } } },
    stream,
  );
  return {
    status: stream.meta.statusCode,
    headers: stream.meta.headers,
    body: Buffer.concat(chunks).toString(),
    upstream: calls[0],
  };
}
