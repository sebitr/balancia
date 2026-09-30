import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { GroupSnapshot } from "@/lib/offline/snapshot";
import { OfflineEntryProvider, useOfflineEntry } from "./offline-entry";

/**
 * The local drawer, and the form it fetches only when it opens.
 *
 * The provider wraps every group screen, so whatever it imports is paid for
 * by the first group screen an invited guest opens on a phone. The form is the
 * largest module graph in the app, which is why it is loaded lazily here —
 * and "lazily" is asserted rather than assumed: the form's module is counted
 * as it is evaluated, and a static import at the top of `offline-entry.tsx`
 * would evaluate it the moment this file imported the provider.
 */

const { formEvaluated, formGate, loadSnapshot } = vi.hoisted(() => {
  let open: () => void = () => {};
  const gate = {
    promise: Promise.resolve(),
    /** Holds the form's module back until `release` is called. */
    hold() {
      this.promise = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release() {
      open();
    },
  };
  return {
    formEvaluated: vi.fn(),
    formGate: gate,
    loadSnapshot: vi.fn(),
  };
});

// The real form, evaluated through a counter. `importOriginal` is what keeps
// it the real one: the test is that the drawer still renders the form after
// the lazy load, not that it renders a stand-in.
vi.mock("@/components/entries/add-entry-form", async (importOriginal) => {
  formEvaluated();
  await formGate.promise;
  return importOriginal();
});

vi.mock("@/lib/offline/snapshot", () => ({ loadSnapshot }));

// What the form reaches for on import and on mount, none of which this test
// is about — the same stand-ins `add-entry-form.test.tsx` uses.
vi.mock("@/modules/expenses/actions", () => ({
  createExpenseAction: vi.fn(),
  createSettlementAction: vi.fn(),
  updateExpenseAction: vi.fn(),
  updateSettlementAction: vi.fn(),
  convertExpenseToSettlementAction: vi.fn(),
  convertSettlementToExpenseAction: vi.fn(),
  deleteExpenseAction: vi.fn(),
  deleteSettlementAction: vi.fn(),
  restoreExpenseAction: vi.fn(),
  restoreSettlementAction: vi.fn(),
}));
vi.mock("@/modules/recurring/actions", () => ({
  createRecurringAction: vi.fn(),
}));
vi.mock("@/lib/offline/outbox", () => ({ enqueueEntry: vi.fn() }));
vi.mock("@/components/expenses/upload-receipt", () => ({
  uploadReceipt: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("@/components/expenses/use-category-suggestion", () => ({
  useCategorySuggestion: () => null,
}));

const SNAPSHOT: GroupSnapshot = {
  groupId: "g1",
  groupName: "Lisbon",
  members: [
    { id: "seb", displayName: "Seb" },
    { id: "herve", displayName: "Hervé" },
  ],
  selfId: "seb",
  currencyMode: "converted",
  baseCurrency: "CHF",
  defaultCurrency: "CHF",
  timezone: "Europe/Zurich",
  frequentCategories: [],
  capturedAt: 0,
};

/** What the bottom bar's Add does with no network. */
function AddButton() {
  const entry = useOfflineEntry();
  return (
    <button type="button" onClick={() => entry?.open()}>
      Add offline
    </button>
  );
}

function renderGroup() {
  return renderWithIntl(
    <OfflineEntryProvider groupId="g1">
      <AddButton />
    </OfflineEntryProvider>,
  );
}

describe("the offline drawer", () => {
  beforeEach(() => {
    loadSnapshot.mockReset();
    formGate.promise = Promise.resolve();
  });

  // One ordered test rather than several: the module registry is per file,
  // so "not yet evaluated" can only be observed before anything has opened
  // the form, and a second test would find it already loaded by the first.
  it("fetches the form when it opens, shows its outline meanwhile, then renders it", async () => {
    const user = userEvent.setup();
    loadSnapshot.mockResolvedValue(SNAPSHOT);
    formGate.hold();

    renderGroup();

    // A group screen, with the provider mounted and nothing asked of it.
    expect(formEvaluated).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Add offline" }));

    // The snapshot is in hand and the form's code is still on its way: the
    // drawer is up, drawn as the routed one draws itself while it waits.
    expect(
      await screen.findByRole("status", { name: "Loading…" }),
    ).toBeInTheDocument();
    expect(formEvaluated).toHaveBeenCalledTimes(1);
    expect(loadSnapshot).toHaveBeenCalledWith("g1");

    formGate.release();

    // The real form, from the snapshot: the field every entry starts in. The
    // wait is long because this is the first import of the whole form graph
    // in this file, and a cold transform of it takes seconds on a busy
    // machine — which is the cost this lazy load keeps off the group screen.
    expect(
      await screen.findByRole(
        "textbox",
        { name: "Amount" },
        { timeout: 20_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading…" })).toBeNull();
  }, 30_000);

  it("says what to do when this device has no copy of the group", async () => {
    const user = userEvent.setup();
    loadSnapshot.mockResolvedValue(null);

    renderGroup();
    await user.click(screen.getByRole("button", { name: "Add offline" }));

    expect(
      await screen.findByText("Nothing saved for this group yet"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Amount" })).toBeNull();
  });
});
