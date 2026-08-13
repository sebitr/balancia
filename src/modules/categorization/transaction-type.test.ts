import { describe, expect, it } from "vitest";
import { detectTransactionType, isIncomeLike } from "./transaction-type";

/**
 * What the transaction *is*, before anyone asks what it was for.
 *
 * The interesting cases are the near-misses: a word that names the type in
 * one sentence and something else entirely in the next.
 */

const type = (text: string) => detectTransactionType(text).type;

describe("detectTransactionType", () => {
  it("treats an ordinary purchase as an expense", () => {
    expect(type("MIGROS 1234")).toBe("expense");
    expect(type("Dîner au restaurant")).toBe("expense");
    expect(type("")).toBe("expense");
  });

  it("recognises refunds in both languages", () => {
    expect(type("Card refund")).toBe("refund");
    expect(type("Reversed payment")).toBe("refund");
    expect(type("Remboursement carte")).toBe("refund");
    expect(type("Paiement annulé")).toBe("refund");
  });

  it("prefers reimbursement over refund when the text says so", () => {
    expect(type("Travel reimbursement")).toBe("reimbursement");
    expect(type("Remboursement de frais")).toBe("reimbursement");
    // The shorter rule still applies on its own.
    expect(type("Remboursement")).toBe("refund");
  });

  it("recognises salary", () => {
    expect(type("Monthly salary")).toBe("salary");
    expect(type("Fiche de paie")).toBe("salary");
    expect(type("Payroll")).toBe("salary");
  });

  it("needs corroboration for a generic word", () => {
    // "transfer" and "virement" alone say nothing about what happened.
    expect(type("Transfer")).toBe("expense");
    expect(type("Virement")).toBe("expense");
    expect(type("Transfer to savings")).toBe("transfer");
    expect(type("Virement entre comptes")).toBe("transfer");
  });

  it("does not mistake a product name for income", () => {
    // The classic: "prime" is French for a bonus, and Amazon's subscription.
    expect(type("AMAZON PRIME")).toBe("expense");
    expect(type("Versement prime employeur")).toBe("other_income");
    // "commission" is usually a bank charge.
    expect(type("Frais de commission")).toBe("expense");
    expect(type("Commission payment")).toBe("other_income");
    // "traitement" is a salary, a medical treatment and a processing fee.
    expect(type("Frais de traitement")).toBe("expense");
    expect(type("Traitement mensuel")).toBe("salary");
  });

  it("keeps buying a present an expense, not a gift received", () => {
    expect(type("Cadeau anniversaire Léa")).toBe("expense");
    expect(type("Birthday gift for Léa")).toBe("expense");
    expect(type("Cadeau reçu")).toBe("gift_income");
    expect(type("Cash gift")).toBe("gift_income");
  });

  it("explains itself", () => {
    expect(detectTransactionType("Remboursement de frais").signals).toEqual([
      "type:remboursement de frais",
    ]);
  });
});

describe("isIncomeLike", () => {
  it("covers every direction of money that is not spending", () => {
    expect(isIncomeLike("salary")).toBe(true);
    expect(isIncomeLike("refund")).toBe(true);
    expect(isIncomeLike("expense")).toBe(false);
    expect(isIncomeLike("transfer")).toBe(false);
  });
});
