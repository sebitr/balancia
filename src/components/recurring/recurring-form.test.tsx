import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { RecurringForm } from "./recurring-form";

/**
 * The day a new schedule starts on.
 *
 * The schedule is read on the group's calendar, so its first eligible day has
 * to be today on that calendar too. The form used to take today in UTC, which
 * started a schedule a day late in the Americas every evening and a day early
 * in the Pacific every morning — early enough that the worker would catch up
 * on an occurrence nobody had asked for.
 *
 * Only `Date` is faked: the clock is what is under test, and nothing here
 * waits on a timer.
 */

const { createRecurring, success } = vi.hoisted(() => ({
  createRecurring: vi.fn(),
  success: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/modules/recurring/actions", () => ({
  createRecurringAction: createRecurring,
}));
vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => success(...args), error: vi.fn() },
}));

function renderForm(timezone: string) {
  return renderWithIntl(
    <RecurringForm
      groupId="g1"
      participants={[
        { id: "seb", displayName: "Seb" },
        { id: "cyril", displayName: "Cyril" },
      ]}
      currencyMode="separate"
      baseCurrency={null}
      defaultCurrency="CHF"
      timezone={timezone}
    />,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RecurringForm", () => {
  it("starts on today in Auckland while UTC is still on yesterday", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Nine in the morning on the 15th in Auckland.
    vi.setSystemTime(new Date("2025-03-14T20:00:00Z"));
    renderForm("Pacific/Auckland");

    expect(screen.getByLabelText("Starting")).toHaveValue("2025-03-15");
  });

  it("starts on today in New York when UTC has already moved on", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Half past eleven at night on the 14th in New York.
    vi.setSystemTime(new Date("2025-03-15T03:30:00Z"));
    renderForm("America/New_York");

    expect(screen.getByLabelText("Starting")).toHaveValue("2025-03-14");
  });
});

/**
 * What saving is confirmed with.
 *
 * "Recurring expense set up" was said the same way whether the first expense
 * had just been added or was a month off. It says which now — and a series
 * that took a form to set up is the kind of change a toast is for.
 */
describe("RecurringForm, once saved", () => {
  async function save(series: {
    added: number;
    addedFrom: string | null;
    next: string | null;
  }) {
    success.mockClear();
    createRecurring.mockResolvedValue({
      ok: true,
      data: { id: "r1", ...series },
    });
    const user = userEvent.setup();
    renderForm("Europe/Zurich");
    await user.type(screen.getByLabelText("Description"), "Internet");
    await user.type(screen.getByLabelText("Amount"), "90");
    await user.click(
      screen.getByRole("button", { name: "Create recurring expense" }),
    );
  }

  it("says the first expense is in the group, and when the next comes", async () => {
    await save({ added: 1, addedFrom: "2026-10-05", next: "2026-11-05" });

    expect(success).toHaveBeenCalledWith(
      "Internet added. The next one is on Nov 5, 2026.",
    );
  });

  it("says when the first one will be added, when it was not", async () => {
    await save({ added: 0, addedFrom: null, next: "2026-11-05" });

    expect(success).toHaveBeenCalledWith(
      "Internet saved. The first one will be added on Nov 5, 2026.",
    );
  });
});
