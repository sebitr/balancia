import { heardEntry } from "@/components/entries/heard-entry";
import type { EntryDraft } from "@/lib/offline/drafts";

/**
 * What another app shared, as the half-written entry the drawer restores.
 *
 * The share screen does not build a form. It builds the *draft* the form
 * already knows how to reopen from — the same shape the drawer writes when
 * somebody closes it with an amount in it — and then navigates to
 * `…/expenses/new#draft=1`. That is the whole reason this feature is manifest
 * and route work rather than drawer work: there is already a supported way to
 * put fields in front of somebody, and a second one would be a second place
 * for the form to be constructed.
 *
 * The parsing is `heardEntry`, unchanged and on this device. It was written
 * for the dictate button and there is nothing about a microphone in it — a
 * line forwarded out of a chat is the same problem as a line somebody spoke,
 * and running it locally means a share needs no round trip and works with the
 * network down to a bar.
 *
 * Two rules the draft has to satisfy, both enforced by `draftFields` when it
 * is read back, and both the reason this takes a roster rather than guessing:
 * the payer must be somebody still in the group, and at least one person must
 * be included. A draft that fails either is dropped whole rather than
 * repaired, and a share that silently opened an empty drawer would look like
 * the feature not working.
 */
export function shareDraft(input: {
  readonly groupId: string;
  /** What was shared, already reduced to one sentence by `sharedText`. */
  readonly text: string;
  /** The group's own currency, for a sentence that names none. */
  readonly fallbackCurrency: string;
  /** The reader, in this group. Pays the entry, as they do in the drawer. */
  readonly selfParticipantId: string;
  /** Everybody active in the group. An equal split starts across all of them. */
  readonly memberIds: readonly string[];
  /** A receipt already uploaded to this group, if one was shared. */
  readonly attachmentId?: string | null;
  readonly now?: Date;
}): EntryDraft {
  const heard = heardEntry(input.text, input.fallbackCurrency);
  const now = input.now ?? new Date();

  return {
    groupId: input.groupId,
    savedAt: now.getTime(),
    fields: {
      type: "expense",
      amountText: heard.amountText,
      // "" from the parser means "leave the group's own alone", and the draft
      // has no group behind it to leave alone — so it carries the fallback the
      // caller already resolved rather than an empty string the form would
      // restore over its own default.
      currency: heard.currency === "" ? input.fallbackCurrency : heard.currency,
      description: heard.description,
      notes: "",
      category: "",
      subcategory: "",
      // Never chosen: a share carries no opinion about the category, and the
      // form's own detection should run on the description as if it had been
      // typed.
      categoryChosen: false,
      date: isoDay(now),
      payerId: input.selfParticipantId,
      includedIds: [...input.memberIds],
      splitMethod: "equal",
      splitValues: {},
      attachmentIds: input.attachmentId ? [input.attachmentId] : [],
    },
    summary: {
      amount: heard.amountText,
      description: heard.description,
    },
  };
}

/** The same `YYYY-MM-DD` the form's own date field starts on. */
function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
