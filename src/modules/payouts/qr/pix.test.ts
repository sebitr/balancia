import { describe, expect, it } from "vitest";
import { crc16CcittFalse } from "./emvco";
import { buildPixQrPayload, type PixQrInput } from "./pix";

/**
 * The BR Code, read back by a parser written from the specification rather
 * than from the builder.
 *
 * Same discipline as the Web Push round trip: the reader below walks the
 * tag-length-value stream the way a bank's would, so a field written in the
 * wrong order or measured with the wrong length fails here instead of at
 * somebody's till. Asserting on the builder's own string would only prove it
 * is stable.
 */

const input: PixQrInput = {
  key: "lea@example.com",
  creditorName: "Léa Martin",
  city: "São Paulo",
  minorUnits: "8420",
  currency: "BRL",
};

/** Every field at one level, as `{ id: value }`. */
function parse(payload: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let cursor = 0;
  while (cursor < payload.length) {
    const id = payload.slice(cursor, cursor + 2);
    const length = Number(payload.slice(cursor + 2, cursor + 4));
    if (!/^\d{2}$/.test(id) || Number.isNaN(length)) {
      throw new Error(`not a field at ${cursor}`);
    }
    fields[id] = payload.slice(cursor + 4, cursor + 4 + length);
    cursor += 4 + length;
  }
  return fields;
}

const build = (overrides: Partial<PixQrInput> = {}) => {
  const payload = buildPixQrPayload({ ...input, ...overrides });
  if (payload === null) throw new Error("expected a payload");
  return payload;
};

describe("the shape of it", () => {
  it("parses cleanly from end to end", () => {
    // If every field's length is right, the walk consumes the whole string and
    // stops exactly at the end. A single wrong length desynchronises the rest.
    expect(() => parse(build())).not.toThrow();
  });

  it("declares the format and that the code is static", () => {
    const fields = parse(build());
    expect(fields["00"]).toBe("01");
    // "Dynamic" in this scheme means the payload is fetched from a URL at scan
    // time, which is a merchant arrangement and not this.
    expect(fields["01"]).toBe("11");
  });

  it("carries the key under the Pix identifier", () => {
    const merchant = parse(parse(build())["26"]!);
    expect(merchant["00"]).toBe("br.gov.bcb.pix");
    expect(merchant["01"]).toBe("lea@example.com");
  });

  it("names the country, the currency and the amount", () => {
    const fields = parse(build());
    expect(fields["58"]).toBe("BR");
    expect(fields["53"]).toBe("986");
    expect(fields["54"]).toBe("84.20");
    expect(fields["52"]).toBe("0000");
  });

  it("writes the reference the specification uses for 'none'", () => {
    expect(parse(parse(build())["62"]!)["05"]).toBe("***");
  });

  it("ends with a checksum over everything before it", () => {
    const payload = build();
    const body = payload.slice(0, -4);
    expect(body.endsWith("6304")).toBe(true);
    expect(payload.slice(-4)).toBe(crc16CcittFalse(body));
  });
});

describe("the name and the city", () => {
  it("folds both to ASCII, because the length is measured in characters", () => {
    const fields = parse(build());
    expect(fields["59"]).toBe("Lea Martin");
    expect(fields["60"]).toBe("Sao Paulo");
  });

  it("says the city is unknown rather than inventing one", () => {
    // Several public generators write "SAO PAULO" into every code they make.
    // This field is a label — the payer's bank resolves the real holder from
    // the key — so the honest answer is available and costs nothing.
    expect(parse(build({ city: null }))["60"]).toBe("NAO INFORMADO");
  });

  it("cuts a long name instead of refusing the whole code", () => {
    const name = parse(build({ creditorName: "Maria".repeat(20) }))["59"]!;
    expect(name.length).toBeLessThanOrEqual(25);
  });

  it("refuses when there is no name left after folding", () => {
    expect(buildPixQrPayload({ ...input, creditorName: "  " })).toBeNull();
  });
});

describe("refusing", () => {
  it("builds nothing for a debt that is not in reais", () => {
    // Pix settles in BRL and carries no rate, so "84.20" in a euro debt would
    // be a figure that is wrong by a third and looks entirely reasonable.
    expect(buildPixQrPayload({ ...input, currency: "EUR" })).toBeNull();
  });

  it("builds nothing for a debt of nothing, or of less than nothing", () => {
    // A negative debt is somebody else's, written backwards. The amount
    // formatter drops the sign, so it would be asked for this way round.
    expect(buildPixQrPayload({ ...input, minorUnits: "0" })).toBeNull();
    expect(buildPixQrPayload({ ...input, minorUnits: "-8420" })).toBeNull();
  });

  it("refuses a key that is not one", () => {
    expect(buildPixQrPayload({ ...input, key: "" })).toBeNull();
    expect(buildPixQrPayload({ ...input, key: "x".repeat(78) })).toBeNull();
    // A key is one of five shapes and all of them are ASCII.
    expect(buildPixQrPayload({ ...input, key: "léa@example.com" })).toBeNull();
  });

  it("takes the longest key the specification allows", () => {
    const key = `${"k".repeat(69)}@bank.br`;
    expect(key.length).toBe(77);
    expect(parse(parse(build({ key }))["26"]!)["01"]).toBe(key);
  });
});
