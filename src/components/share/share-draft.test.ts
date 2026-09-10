import { describe, expect, it } from "vitest";
import { draftFields } from "@/components/entries/draft-fields";
import { shareDraft } from "./share-draft";

/**
 * What a share becomes, and — the part that matters — whether the drawer will
 * take it back.
 *
 * `draftFields` is the gate on the other side: it drops a draft whole when the
 * payer is not in the roster or nobody is included, because a draft that names
 * somebody who left would break an entry nobody had touched. A share screen
 * that wrote one of those would look exactly like the feature not working —
 * the drawer would open empty and nothing would say why — so every case below
 * ends by reading the draft back through the same gate.
 */

const ME = "1111aaaa-0000-4000-8000-000000000001";
const JONAS = "1111aaaa-0000-4000-8000-000000000002";
const MEMBERS = [ME, JONAS];

function draftFor(text: string, currency = "CHF") {
  return shareDraft({
    groupId: "group-1",
    text,
    fallbackCurrency: currency,
    selfParticipantId: ME,
    memberIds: MEMBERS,
    now: new Date("2026-09-10T08:30:00Z"),
  });
}

describe("shareDraft", () => {
  it("reads a forwarded sentence into an entry the drawer restores", () => {
    const draft = draftFor("dinner was 84.20");
    const restored = draftFields(draft.fields, MEMBERS);

    expect(restored).not.toBeNull();
    expect(restored!.amountText).toBe("84.20");
    expect(restored!.description).toBe("dinner was");
    expect(restored!.currency).toBe("CHF");
    expect(restored!.payerId).toBe(ME);
    expect(restored!.includedIds).toEqual(MEMBERS);
    expect(restored!.splitMethod).toBe("equal");
  });

  it("lets the words overrule the group's currency", () => {
    const restored = draftFields(draftFor("24.50 euros Coop").fields, MEMBERS);
    expect(restored!.currency).toBe("EUR");
  });

  it("keeps the group's currency when the words name none", () => {
    // The parser answers "" for "leave it alone", and there is no form behind
    // this draft to leave alone — an empty string here would be restored over
    // the drawer's own default.
    const restored = draftFor("Coop 24.50", "SEK");
    expect(draftFields(restored.fields, MEMBERS)!.currency).toBe("SEK");
  });

  it("still produces a restorable draft when nothing readable was shared", () => {
    // A share carrying only a link, or a photograph with no message. The
    // drawer should open on the group with the receipt attached rather than
    // refuse the draft.
    const draft = shareDraft({
      groupId: "group-1",
      text: "",
      fallbackCurrency: "CHF",
      selfParticipantId: ME,
      memberIds: MEMBERS,
      attachmentId: "aaaa1111-0000-4000-8000-00000000000f",
    });
    const restored = draftFields(draft.fields, MEMBERS);

    expect(restored).not.toBeNull();
    expect(restored!.amountText).toBe("");
    expect(restored!.attachmentIds).toEqual([
      "aaaa1111-0000-4000-8000-00000000000f",
    ]);
  });

  it("dates the entry today, in the form's own format", () => {
    expect(draftFor("12 coffee").fields).toMatchObject({ date: "2026-09-10" });
  });

  it("summarises itself the way the group screen's dashed row reads it", () => {
    const draft = draftFor("84.20 dinner");
    expect(draft.summary).toEqual({ amount: "84.20", description: "dinner" });
  });

  it("carries no receipt when none was shared", () => {
    expect(
      draftFields(draftFor("12 coffee").fields, MEMBERS)!.attachmentIds,
    ).toEqual([]);
  });
});
