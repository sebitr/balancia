import { describe, expect, it } from "vitest";
import {
  MULTIPART_ENVELOPE_BYTES,
  PROXY_BODY_LIMIT_BYTES,
  UPLOAD_CEILING_BYTES,
  readUploadForm,
} from "./upload-limit";
import nextConfig from "../../next.config";

/**
 * The upload ceiling, and a body that says nothing about its size.
 *
 * Two failures this file exists for. The proxy in front of every route used to
 * keep ten megabytes of a request and quietly drop the rest, whatever
 * `UPLOAD_MAX_BYTES` promised; and the only size check before the body was
 * parsed read `Content-Length`, which a chunked request does not send.
 */

function multipart(fileBytes: number): {
  body: Uint8Array<ArrayBuffer>;
  type: string;
} {
  const boundary = "----balancia-test-boundary";
  const head = new TextEncoder().encode(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="receipt.jpg"\r\n' +
      "Content-Type: image/jpeg\r\n\r\n",
  );
  const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + fileBytes + tail.length);
  body.set(head, 0);
  body.fill(0x61, head.length, head.length + fileBytes);
  body.set(tail, head.length + fileBytes);
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

/** A body streamed in pieces, the way a chunked upload arrives: no length. */
function chunked(
  body: Uint8Array,
  type: string,
): { request: Request; pulled: () => number } {
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= body.length) {
        controller.close();
        return;
      }
      const next = body.subarray(offset, offset + 16 * 1024);
      offset += next.length;
      controller.enqueue(next);
    },
  });
  const request = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "content-type": type },
    body: stream,
    duplex: "half",
  } as RequestInit);
  return { request, pulled: () => offset };
}

describe("reading an upload", () => {
  it("parses a form within the limit", async () => {
    const { body, type } = multipart(1000);
    const form = await readUploadForm(
      new Request("http://localhost/upload", {
        method: "POST",
        headers: { "content-type": type },
        body,
      }),
      2000,
    );
    const file = form?.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).size).toBe(1000);
    expect((file as File).name).toBe("receipt.jpg");
  });

  it("refuses a declared length over the limit without reading a byte", async () => {
    const { body, type } = multipart(10);
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: {
        "content-type": type,
        "content-length": String(2000 + MULTIPART_ENVELOPE_BYTES + 1),
      },
      body,
    });
    expect(await readUploadForm(request, 2000)).toBeNull();
    expect(request.bodyUsed).toBe(false);
  });

  it("refuses a chunked body once it passes the limit, and stops reading", async () => {
    const limit = 64 * 1024;
    const { body, type } = multipart(4 * limit);
    const { request, pulled } = chunked(body, type);

    expect(request.headers.get("content-length")).toBeNull();
    expect(await readUploadForm(request, limit)).toBeNull();
    // Given up on shortly after the limit, not read to the end.
    expect(pulled()).toBeLessThan(body.length);
  });

  it("parses a chunked body that stays within the limit", async () => {
    const { body, type } = multipart(40 * 1024);
    const { request } = chunked(body, type);
    const form = await readUploadForm(request, 64 * 1024);
    expect((form?.get("file") as File).size).toBe(40 * 1024);
  });
});

describe("the ceiling", () => {
  it("lets the proxy keep more of a body than any upload route will read", () => {
    // The margin is what makes a body the proxy cut off read as too large
    // rather than as a complete, shorter file: the proxy drops the whole
    // chunk that crosses its limit, and Node's chunks are tens of kilobytes.
    expect(PROXY_BODY_LIMIT_BYTES).toBeGreaterThanOrEqual(
      UPLOAD_CEILING_BYTES + MULTIPART_ENVELOPE_BYTES + 512 * 1024,
    );
  });

  it("is the proxy limit the build is configured with", () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(
      PROXY_BODY_LIMIT_BYTES,
    );
  });
});
