import { describe, expect, it } from "vitest";
import type { SwissCreditorAddress } from "@/modules/payouts/qr/swiss";
import { payWithOptions, type PayWithInput } from "./pay-with";

/**
 * What a reminder can honestly carry, and what it must not.
 *
 * The settle screen's rules are already tested where they live. What is worth
 * pinning here is the narrower question this file asks — whether an artefact
 * survives being pasted into a chat app — and the one refusal that is this
 * module's own: a recipient owing in two currencies has no figure any payment
 * instruction may claim, so every instruction that would name one is dropped.
 */

const SWISS_ADDRESS: SwissCreditorAddress = {
  street: "Rue du Rhône",
  buildingNumber: "12",
  postalCode: "1204",
  town: "Genève",
  country: "CH",
};

function input(overrides: Partial<PayWithInput> = {}): PayWithInput {
  return {
    methods: [],
    address: null,
    creditorName: "Seb Trosset",
    groupName: "Portugal, March",
    debts: [{ amount: "14800", currency: "EUR" }],
    ...overrides,
  };
}

describe("what goes in the bubble", () => {
  /** The pitch's own example: a Girocode, on a euro debt into a SEPA account. */
  it("puts the IBAN in the text and the Girocode in the picture", () => {
    const [option] = payWithOptions(
      input({
        methods: [{ method: "bank", detail: "DE89370400440532013000" }],
      }),
    );

    expect(option.kind).toBe("detail");
    expect(option.text).toBe("DE89370400440532013000");
    expect(option.code?.standard).toBe("epc");
    // The amount is in the payload, which is the whole reason for sending it.
    expect(option.code?.payload).toContain("EUR148.00");
  });

  /**
   * A Swiss account is served by the Swiss standard and by nothing else, and
   * that standard needs an address the reader may never have been asked for.
   */
  it("sends a Swiss account with its own code, and without one when the address is missing", () => {
    const methods = [{ method: "bank", detail: "CH9300762011623852957" }];
    const debts = [{ amount: "14800", currency: "CHF" }];

    const [withAddress] = payWithOptions(
      input({ methods, debts, address: SWISS_ADDRESS }),
    );
    expect(withAddress.code?.standard).toBe("swiss");

    const [without] = payWithOptions(input({ methods, debts }));
    // Still worth sending: the IBAN is what somebody would have typed by hand.
    expect(without.text).toBe("CH9300762011623852957");
    expect(without.code).toBeNull();
  });

  /** Pix is pasted at least as often as it is scanned. */
  it("sends a Pix key as the code itself, because that is how it is paid", () => {
    const [option] = payWithOptions(
      input({
        methods: [{ method: "pix", detail: "seb@example.com" }],
        debts: [{ amount: "14800", currency: "BRL" }],
      }),
    );

    expect(option.kind).toBe("code");
    expect(option.text).toBe(option.code?.payload);
    expect(option.text.startsWith("0002")).toBe(true);
  });

  it("prefers a link that opens on the payment", () => {
    const [option] = payWithOptions(
      input({ methods: [{ method: "paypal", detail: "paypal.me/seb" }] }),
    );

    expect(option.kind).toBe("link");
    expect(option.text).toBe("https://paypal.me/seb/148.00EUR");
  });

  /**
   * `upi://` is the one custom scheme in the table. It resolves to nothing on
   * a desktop, and a message has no way to know which one it will be read on —
   * so the intent travels as a picture and the address travels as text, which
   * is the same answer the settle screen reaches for.
   */
  it("does not put a custom scheme in the text, but does put it in the picture", () => {
    const [option] = payWithOptions(
      input({
        methods: [{ method: "upi", detail: "seb@okhdfcbank" }],
        debts: [{ amount: "14800", currency: "INR" }],
      }),
    );

    expect(option.kind).toBe("detail");
    expect(option.text).toBe("seb@okhdfcbank");
    expect(option.code?.standard).toBeNull();
    expect(option.code?.payload.startsWith("upi://pay?")).toBe(true);
  });

  it("keeps the reader's own order, which is their answer to what to use", () => {
    const options = payWithOptions(
      input({
        methods: [
          { method: "revolut", detail: "sebtr" },
          { method: "bank", detail: "DE89370400440532013000" },
        ],
      }),
    );

    expect(options.map((option) => option.method)).toEqual(["revolut", "bank"]);
  });

  /** Nothing to send, and nothing half-entered to send either. */
  it("leaves out cash and a method whose detail was never filled in", () => {
    const options = payWithOptions(
      input({
        methods: [
          { method: "cash", detail: "" },
          { method: "twint", detail: "   " },
          { method: "bank", detail: "DE89370400440532013000" },
        ],
      }),
    );

    expect(options.map((option) => option.method)).toEqual(["bank"]);
  });
});

/**
 * A separate-currency group balances each currency on its own and applies no
 * rate anywhere, so somebody owing euros *and* yen is owed two sums with no
 * total between them. Every instruction that would write a figure is therefore
 * writing one of the two and silently discharging neither.
 */
describe("somebody who owes in two currencies", () => {
  const debts = [
    { amount: "14800", currency: "EUR" },
    { amount: "140000", currency: "JPY" },
  ];

  it("gets no code, because a code names one figure", () => {
    const [option] = payWithOptions(
      input({
        methods: [{ method: "bank", detail: "DE89370400440532013000" }],
        debts,
      }),
    );

    expect(option.text).toBe("DE89370400440532013000");
    expect(option.code).toBeNull();
  });

  it("gets the plain address rather than a link carrying half the debt", () => {
    const [option] = payWithOptions(
      input({
        methods: [{ method: "paypal", detail: "paypal.me/seb" }],
        debts,
      }),
    );

    // The detail its owner typed, which is a link to them and not to a sum.
    expect(option.kind).toBe("link");
    expect(option.text).toBe("paypal.me/seb");
    expect(option.text).not.toContain("148");
  });
});
