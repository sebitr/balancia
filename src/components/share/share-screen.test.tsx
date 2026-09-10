import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { ShareScreen, type ShareableGroup } from "./share-screen";
import type { SharedPayload } from "@/lib/offline/shared";

/**
 * The screen a share sheet lands on.
 *
 * Its whole job is to ask which group and then get out of the way, so what is
 * asserted here is the getting out of the way: a draft written in the shape
 * the drawer restores, a navigation to the drawer's own URL with `#draft=1`,
 * and — the one that would be invisible in use — the receipt uploaded to the
 * group that was chosen rather than to whichever one happened to be first.
 *
 * The share is *taken* from the store, so nothing here re-reads it. A screen
 * that asked twice would file the same receipt twice.
 */

const { takeSharedPayload, saveDraft, uploadReceipt, push } = vi.hoisted(
  () => ({
    takeSharedPayload: vi.fn(),
    saveDraft: vi.fn(),
    uploadReceipt: vi.fn(),
    push: vi.fn(),
  }),
);

vi.mock("@/lib/offline/drafts", () => ({ saveDraft }));
vi.mock("@/components/expenses/upload-receipt", () => ({ uploadReceipt }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/offline/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/shared")>()),
  takeSharedPayload,
}));

const ME = "1111aaaa-0000-4000-8000-000000000001";
const JONAS = "1111aaaa-0000-4000-8000-000000000002";

const GROUPS: ShareableGroup[] = [
  {
    id: "g-flat",
    name: "Flat 12",
    icon: "house",
    iconColor: "emerald",
    currency: "CHF",
  },
  {
    id: "g-trip",
    name: "Lisbon",
    icon: "plane",
    iconColor: "coral",
    currency: "EUR",
  },
];

function payload(fields: Partial<SharedPayload> = {}): SharedPayload {
  return {
    id: "incoming",
    sharedAt: Date.now(),
    title: "",
    text: "dinner was 84.20",
    url: "",
    file: null,
    ...fields,
  };
}

function rosterAnswers() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      participantId: ME,
      participants: [{ id: ME }, { id: JONAS }],
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  saveDraft.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", rosterAnswers());
});

describe("ShareScreen", () => {
  it("says what arrived and asks which group it is for", async () => {
    takeSharedPayload.mockResolvedValue(payload());
    renderWithIntl(<ShareScreen groups={GROUPS} />);

    expect(await screen.findByText("dinner was 84.20")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Flat 12/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lisbon/ })).toBeInTheDocument();
  });

  it("writes the chosen group's draft and opens its drawer", async () => {
    takeSharedPayload.mockResolvedValue(payload());
    renderWithIntl(<ShareScreen groups={GROUPS} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Lisbon/ }),
    );

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    const draft = saveDraft.mock.calls[0]![0] as {
      groupId: string;
      fields: { amountText: string; currency: string; payerId: string };
    };
    expect(draft.groupId).toBe("g-trip");
    expect(draft.fields.amountText).toBe("84.20");
    // The group that was chosen, not the one at the top of the list.
    expect(draft.fields.currency).toBe("EUR");
    expect(draft.fields.payerId).toBe(ME);

    expect(push).toHaveBeenCalledWith("/groups/g-trip/expenses/new#draft=1");
  });

  it("uploads a shared receipt to the group that was chosen", async () => {
    const file = new File(["x"], "receipt.jpg", { type: "image/jpeg" });
    takeSharedPayload.mockResolvedValue(payload({ file, text: "" }));
    uploadReceipt.mockResolvedValue({
      ok: true,
      file: { id: "att-1", fileName: "receipt.jpg" },
    });
    renderWithIntl(<ShareScreen groups={GROUPS} />);

    expect(await screen.findByText("receipt.jpg")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Flat 12/ }));

    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    expect(uploadReceipt).toHaveBeenCalledWith("g-flat", file, "receipt.jpg");
    const draft = saveDraft.mock.calls[0]![0] as {
      fields: { attachmentIds: string[] };
    };
    expect(draft.fields.attachmentIds).toEqual(["att-1"]);
  });

  it("still files the entry when the receipt will not upload", async () => {
    // The words and the amount are worth having on their own, and the drawer
    // can attach the photograph again from the library.
    const file = new File(["x"], "receipt.jpg", { type: "image/jpeg" });
    takeSharedPayload.mockResolvedValue(payload({ file }));
    uploadReceipt.mockResolvedValue({ ok: false, reason: "offline" });
    renderWithIntl(<ShareScreen groups={GROUPS} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Flat 12/ }),
    );

    await waitFor(() => expect(push).toHaveBeenCalled());
    const draft = saveDraft.mock.calls[0]![0] as {
      fields: { attachmentIds: string[]; amountText: string };
    };
    expect(draft.fields.attachmentIds).toEqual([]);
    expect(draft.fields.amountText).toBe("84.20");
  });

  it("asks nothing when there is only one group to ask about", async () => {
    takeSharedPayload.mockResolvedValue(payload());
    renderWithIntl(<ShareScreen groups={[GROUPS[0]!]} />);

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/groups/g-flat/expenses/new#draft=1"),
    );
  });

  it("shows the empty state when nothing is waiting", async () => {
    // A reload of this screen, or somebody opening /share by hand: the share
    // was taken by the first read and is deliberately not there twice.
    takeSharedPayload.mockResolvedValue(null);
    renderWithIntl(<ShareScreen groups={GROUPS} />);

    expect(await screen.findByText("Nothing was shared")).toBeInTheDocument();
    expect(saveDraft).not.toHaveBeenCalled();
  });

  it("says so, and keeps the list, when filing fails", async () => {
    takeSharedPayload.mockResolvedValue(payload());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    renderWithIntl(<ShareScreen groups={GROUPS} />);

    await userEvent.click(
      await screen.findByRole("button", { name: /Lisbon/ }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    // Still offered, so the other group is one tap away rather than a reshare.
    expect(screen.getByRole("button", { name: /Flat 12/ })).toBeEnabled();
  });
});
