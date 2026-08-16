/**
 * A very small Prometheus-compatible metrics registry.
 *
 * Written rather than installed, for the same reason Web Push and Sign in with
 * Apple are (architecture decisions 17 and 19): the exposition format is a
 * short, fully specified piece of text, the whole of it that Balancia needs is
 * below, and a metrics library would add a dependency tree to a project whose
 * default is to export nothing at all.
 *
 * These numbers are **exact and local**. They are not telemetry: nothing in
 * Balancia transmits them, and the only way off this instance is an operator
 * pointing their own Prometheus at `/api/metrics`. That is also why labels
 * here may be precise where a telemetry bucket may not — the audience is the
 * person who runs the server, looking at their own server.
 *
 * Label values still never carry identifiers. Routes are templates
 * (`/api/groups/[groupId]/export`), never paths; queue and action names are
 * literals from the source. An unbounded label is a memory leak as well as a
 * privacy problem, and this registry has no eviction.
 */

export type Labels = Readonly<Record<string, string>>;

interface Sample {
  readonly labels: Labels;
  value: number;
}

function labelKey(labels: Labels): string {
  const names = Object.keys(labels).sort();
  return names.map((name) => `${name}=${labels[name]}`).join(",");
}

/** Escapes a label value per the exposition format: backslash, quote, newline. */
function escapeLabelValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
}

function renderLabels(labels: Labels): string {
  const names = Object.keys(labels).sort();
  if (names.length === 0) return "";
  const pairs = names.map(
    (name) => `${name}="${escapeLabelValue(labels[name])}"`,
  );
  return `{${pairs.join(",")}}`;
}

abstract class Metric {
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  abstract readonly type: "counter" | "gauge" | "histogram";
  abstract render(): string[];

  protected header(): string[] {
    return [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} ${this.type}`,
    ];
  }
}

/** A number that only goes up. */
export class Counter extends Metric {
  readonly type = "counter";
  private readonly samples = new Map<string, Sample>();

  increment(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    const existing = this.samples.get(key);
    if (existing) {
      existing.value += by;
      return;
    }
    this.samples.set(key, { labels, value: by });
  }

  override render(): string[] {
    const lines = this.header();
    for (const sample of this.samples.values()) {
      lines.push(`${this.name}${renderLabels(sample.labels)} ${sample.value}`);
    }
    return lines;
  }
}

/** A number that goes up and down, read at scrape time. */
export class Gauge extends Metric {
  readonly type = "gauge";
  private readonly samples = new Map<string, Sample>();
  private reader?: (gauge: Gauge) => void;

  /**
   * Registers a callback run just before rendering.
   *
   * Gauges like resident memory have no natural moment to be written; they are
   * read when somebody asks. The callback receives the gauge so it has
   * somewhere to put the answer.
   */
  onCollect(reader: (gauge: Gauge) => void): this {
    this.reader = reader;
    return this;
  }

  set(value: number, labels: Labels = {}): void {
    this.samples.set(labelKey(labels), { labels, value });
  }

  override render(): string[] {
    this.reader?.(this);
    const lines = this.header();
    for (const sample of this.samples.values()) {
      lines.push(`${this.name}${renderLabels(sample.labels)} ${sample.value}`);
    }
    return lines;
  }
}

interface HistogramSample {
  readonly labels: Labels;
  readonly counts: number[];
  sum: number;
  count: number;
}

/** Durations, in the cumulative-bucket form Prometheus expects. */
export class Histogram extends Metric {
  readonly type = "histogram";
  private readonly samples = new Map<string, HistogramSample>();

  constructor(
    name: string,
    help: string,
    readonly bounds: readonly number[],
  ) {
    super(name, help);
  }

  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    let sample = this.samples.get(key);
    if (!sample) {
      sample = {
        labels,
        counts: new Array(this.bounds.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.samples.set(key, sample);
    }
    sample.sum += value;
    sample.count += 1;
    for (const [index, bound] of this.bounds.entries()) {
      if (value <= bound) sample.counts[index] += 1;
    }
  }

  override render(): string[] {
    const lines = this.header();
    for (const sample of this.samples.values()) {
      let cumulative = 0;
      for (const [index, bound] of this.bounds.entries()) {
        cumulative = sample.counts[index];
        lines.push(
          `${this.name}_bucket${renderLabels({
            ...sample.labels,
            le: String(bound),
          })} ${cumulative}`,
        );
      }
      lines.push(
        `${this.name}_bucket${renderLabels({
          ...sample.labels,
          le: "+Inf",
        })} ${sample.count}`,
      );
      lines.push(
        `${this.name}_sum${renderLabels(sample.labels)} ${sample.sum}`,
      );
      lines.push(
        `${this.name}_count${renderLabels(sample.labels)} ${sample.count}`,
      );
    }
    return lines;
  }
}

/** Everything registered in this process. */
export class Registry {
  private readonly metrics = new Map<string, Metric>();

  counter(name: string, help: string): Counter {
    return this.remember(name, () => new Counter(name, help)) as Counter;
  }

  gauge(name: string, help: string): Gauge {
    return this.remember(name, () => new Gauge(name, help)) as Gauge;
  }

  histogram(name: string, help: string, bounds: readonly number[]): Histogram {
    return this.remember(
      name,
      () => new Histogram(name, help, bounds),
    ) as Histogram;
  }

  private remember(name: string, create: () => Metric): Metric {
    const existing = this.metrics.get(name);
    if (existing) return existing;
    const metric = create();
    this.metrics.set(name, metric);
    return metric;
  }

  /** The exposition text, as Prometheus reads it. */
  render(): string {
    const lines: string[] = [];
    for (const metric of [...this.metrics.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      lines.push(...metric.render());
    }
    return `${lines.join("\n")}\n`;
  }

  /** Test hook: start from nothing. */
  clear(): void {
    this.metrics.clear();
  }
}

/**
 * One registry per process.
 *
 * Held on `globalThis` for the same reason the database pool is: Next.js
 * evaluates a module more than once across its bundles and across a hot
 * reload, and counters that reset on every edit — or that exist twice, each
 * with half the truth — are worse than none.
 */
declare global {
  var __balanciaMetrics: Registry | undefined;
}

export function getRegistry(): Registry {
  globalThis.__balanciaMetrics ??= new Registry();
  return globalThis.__balanciaMetrics;
}
