import { beforeEach, describe, expect, it } from "vitest";
import { Registry, getRegistry } from "./registry";

/**
 * The exposition format, which is the whole reason this file exists rather
 * than a dependency. If it does not parse as Prometheus text, it is not
 * metrics, it is a text file.
 */

let registry: Registry;

beforeEach(() => {
  registry = new Registry();
});

describe("counters", () => {
  it("renders a HELP line, a TYPE line and a value", () => {
    registry.counter("balancia_test_total", "A test counter.").increment();

    expect(registry.render()).toBe(
      [
        "# HELP balancia_test_total A test counter.",
        "# TYPE balancia_test_total counter",
        "balancia_test_total 1",
        "",
      ].join("\n"),
    );
  });

  it("keeps one series per label set", () => {
    const counter = registry.counter("balancia_test_total", "help");
    counter.increment({ queue: "import.commit", outcome: "ok" });
    counter.increment({ queue: "import.commit", outcome: "ok" });
    counter.increment({ queue: "import.commit", outcome: "failed" });

    const output = registry.render();
    expect(output).toContain(
      'balancia_test_total{outcome="ok",queue="import.commit"} 2',
    );
    expect(output).toContain(
      'balancia_test_total{outcome="failed",queue="import.commit"} 1',
    );
  });

  it("sorts label names so a series renders identically every scrape", () => {
    registry
      .counter("balancia_test_total", "help")
      .increment({ route: "/api/rates", method: "GET" });
    expect(registry.render()).toContain('{method="GET",route="/api/rates"}');
  });

  it("escapes what the format says to escape", () => {
    registry
      .counter("balancia_test_total", "help")
      .increment({ label: 'a "quoted" \\ value\nsecond line' });
    expect(registry.render()).toContain(
      'balancia_test_total{label="a \\"quoted\\" \\\\ value\\nsecond line"} 1',
    );
  });
});

describe("gauges", () => {
  it("replaces rather than accumulates", () => {
    const gauge = registry.gauge("balancia_test_gauge", "help");
    gauge.set(4);
    gauge.set(7);
    expect(registry.render()).toContain("balancia_test_gauge 7");
  });

  it("reads its value at scrape time when asked to", () => {
    let reads = 0;
    registry.gauge("balancia_test_gauge", "help").onCollect((gauge) => {
      reads += 1;
      gauge.set(reads * 10);
    });

    expect(registry.render()).toContain("balancia_test_gauge 10");
    expect(registry.render()).toContain("balancia_test_gauge 20");
  });
});

describe("histograms", () => {
  it("renders cumulative buckets, a sum and a count", () => {
    const histogram = registry.histogram(
      "balancia_test_seconds",
      "help",
      [0.1, 1],
    );
    histogram.observe(0.05);
    histogram.observe(0.5);
    histogram.observe(5);

    const output = registry.render();
    expect(output).toContain('balancia_test_seconds_bucket{le="0.1"} 1');
    expect(output).toContain('balancia_test_seconds_bucket{le="1"} 2');
    expect(output).toContain('balancia_test_seconds_bucket{le="+Inf"} 3');
    expect(output).toContain("balancia_test_seconds_count 3");
    expect(output).toContain("balancia_test_seconds_sum 5.55");
  });

  it("keeps buckets per label set", () => {
    const histogram = registry.histogram("balancia_test_seconds", "help", [1]);
    histogram.observe(0.5, { route: "/api/rates" });
    histogram.observe(2, { route: "/api/metrics" });

    const output = registry.render();
    expect(output).toContain(
      'balancia_test_seconds_bucket{le="1",route="/api/rates"} 1',
    );
    expect(output).toContain(
      'balancia_test_seconds_bucket{le="1",route="/api/metrics"} 0',
    );
  });
});

describe("the registry", () => {
  it("returns the same metric for the same name", () => {
    // Accessors are called per request; a second call must not reset a counter
    // or produce a duplicate series.
    registry.counter("balancia_test_total", "help").increment();
    registry.counter("balancia_test_total", "help").increment();

    const lines = registry
      .render()
      .split("\n")
      .filter((line) => line === "balancia_test_total 2");
    expect(lines).toHaveLength(1);
  });

  it("renders metrics in a stable order", () => {
    registry.counter("balancia_b_total", "help").increment();
    registry.counter("balancia_a_total", "help").increment();
    expect(registry.render().indexOf("balancia_a_total")).toBeLessThan(
      registry.render().indexOf("balancia_b_total"),
    );
  });

  it("is one registry per process", () => {
    // Held on globalThis for the same reason the database pool is: Next.js
    // evaluates a module more than once, and counters that exist twice with
    // half the truth each are worse than none.
    expect(getRegistry()).toBe(getRegistry());
  });

  it("renders an empty registry as an empty document", () => {
    expect(new Registry().render()).toBe("\n");
  });
});
