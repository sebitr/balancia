import { describe, expect, it } from "vitest";
import { readCapped, readRequestText } from "./read-capped";

/**
 * A body that never ends, handed out one chunk per read.
 *
 * `pulls` counts how much of it was asked for, and `cancelled` whether the
 * reader said it wanted no more — the two things a bounded read must get
 * right, since `response.text()` on this would never return.
 */
function endlessBody(chunk: Uint8Array) {
  const state = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulls += 1;
      controller.enqueue(chunk);
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

describe("reading a response without trusting its length", () => {
  it("stops at the cap on a body that never ends, and cancels it", async () => {
    const { stream, state } = endlessBody(
      new TextEncoder().encode("x".repeat(64)),
    );

    const text = await readCapped(new Response(stream), 1_000);

    expect(text).toBe("x".repeat(1_000));
    expect(state.cancelled).toBe(true);
    // Sixteen chunks cover the cap; a stream may pull a little ahead to fill
    // its queue, but not on and on.
    expect(state.pulls).toBeLessThan(20);
  });

  /**
   * A network chunk is often larger than the whole cap. Dropping the chunk
   * that crosses it, rather than cutting it, would read nothing at all.
   */
  it("keeps the part of a chunk that fits", async () => {
    const { stream } = endlessBody(
      new TextEncoder().encode("y".repeat(65_536)),
    );

    expect(await readCapped(new Response(stream), 10)).toBe("y".repeat(10));
  });

  it("reads a body shorter than the cap whole", async () => {
    expect(await readCapped(new Response("Bad VAPID token"), 800)).toBe(
      "Bad VAPID token",
    );
  });

  it("reads nothing from a response without a body", async () => {
    expect(await readCapped(new Response(null, { status: 204 }), 800)).toBe("");
  });

  /** A character cut in half at the cap is replaced, not left dangling. */
  it("does not split a character into invalid text", async () => {
    // "é" is two bytes in UTF-8, so four bytes end halfway through the second.
    const text = await readCapped(new Response("aéé"), 4);

    expect(text).toBe(`aé${String.fromCodePoint(0xfffd)}`);
  });
});

describe("reading a request without trusting its length", () => {
  /** What a chunked upload looks like: a body, and no Content-Length at all. */
  function chunked(stream: ReadableStream<Uint8Array>): Request {
    return new Request("https://balancia.test/mcp", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
  }

  it("stops a chunked body that never ends, and cancels it", async () => {
    const { stream, state } = endlessBody(
      new TextEncoder().encode("x".repeat(64)),
    );

    expect(await readRequestText(chunked(stream), 1_000)).toBeNull();
    expect(state.cancelled).toBe(true);
    expect(state.pulls).toBeLessThan(40);
  });

  it("refuses a declared size without reading anything", async () => {
    const { stream, state } = endlessBody(new TextEncoder().encode("x"));
    const request = new Request("https://balancia.test/mcp", {
      method: "POST",
      headers: { "Content-Length": "999999" },
      body: stream,
      duplex: "half",
    } as RequestInit);

    expect(await readRequestText(request, 1_000)).toBeNull();
    // A stream pulls once to fill its own queue before anybody reads it.
    expect(state.pulls).toBeLessThanOrEqual(1);
  });

  it("reads a body within the cap whole, multi-byte characters included", async () => {
    const request = new Request("https://balancia.test/mcp", {
      method: "POST",
      body: '{"a":"éé"}',
    });

    expect(await readRequestText(request, 1_000)).toBe('{"a":"éé"}');
  });

  it("reads nothing from a request without a body", async () => {
    const request = new Request("https://balancia.test/mcp");

    expect(await readRequestText(request, 1_000)).toBe("");
  });

  it("takes a body of exactly the cap", async () => {
    const request = new Request("https://balancia.test/mcp", {
      method: "POST",
      body: "y".repeat(100),
    });

    expect(await readRequestText(request, 100)).toBe("y".repeat(100));
  });
});
