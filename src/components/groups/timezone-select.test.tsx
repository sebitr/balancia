import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { TimezoneSelect } from "./timezone-select";

/**
 * The picker, from the point of view of someone looking for their own city.
 *
 * Finding a zone is the whole job: four hundred of them are only usable if
 * typing a few letters gets you there, and if the value you already have is
 * still shown even when the runtime's list has never heard of it.
 */

function renderSelect(value = "Europe/Paris") {
  const onValueChange = vi.fn();
  const view = renderWithIntl(
    <TimezoneSelect
      id="timezone"
      name="timezone"
      value={value}
      onValueChange={onValueChange}
    />,
  );
  return { ...view, onValueChange, user: userEvent.setup() };
}

function hiddenValue(container: HTMLElement): string | undefined {
  return container.querySelector<HTMLInputElement>('input[name="timezone"]')
    ?.value;
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("combobox"));
  return screen.getByRole("listbox");
}

/** `Europe / ParisGMT+02:00` → `Europe/Paris`, whatever the runtime listed. */
function zoneOf(option: HTMLElement): string {
  return (option.textContent ?? "")
    .split("GMT")[0]
    .replace(/ \/ /g, "/")
    .replace(/ /g, "_");
}

describe("TimezoneSelect", () => {
  it("shows the selected zone and its current offset", () => {
    const { container } = renderSelect("Asia/Tokyo");
    expect(screen.getByRole("combobox")).toHaveTextContent("Asia / Tokyo");
    expect(screen.getByRole("combobox")).toHaveTextContent("GMT+09:00");
    expect(hiddenValue(container)).toBe("Asia/Tokyo");
  });

  it("posts the value as form data without a select element", () => {
    const { container } = renderSelect();
    const hidden = container.querySelector('input[name="timezone"]');
    expect(hidden).toHaveAttribute("type", "hidden");
    expect(container.querySelector("select")).toBeNull();
  });

  it("narrows the list as you type", async () => {
    const { user } = renderSelect();
    const listbox = await openPicker(user);
    expect(within(listbox).getAllByRole("option").length).toBeGreaterThan(100);

    await user.type(screen.getByPlaceholderText("Search timezones"), "auck");
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Pacific / Auckland");
  });

  it("finds a zone written with an underscore, and one written with accents", async () => {
    const { user } = renderSelect();
    const listbox = await openPicker(user);
    const search = screen.getByPlaceholderText("Search timezones");

    await user.type(search, "new york");
    expect(within(listbox).getByRole("option")).toHaveTextContent(
      "America / New York",
    );

    await user.clear(search);
    await user.type(search, "são paulo");
    expect(within(listbox).getByRole("option")).toHaveTextContent(
      "America / Sao Paulo",
    );
  });

  it("reports the chosen zone and closes", async () => {
    const { user, onValueChange } = renderSelect();
    const listbox = await openPicker(user);
    await user.type(screen.getByPlaceholderText("Search timezones"), "auck");
    await user.click(within(listbox).getByRole("option"));

    expect(onValueChange).toHaveBeenCalledWith("Pacific/Auckland");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("picks the top match on Enter", async () => {
    const { user, onValueChange } = renderSelect();
    await openPicker(user);
    await user.type(
      screen.getByPlaceholderText("Search timezones"),
      "auck{Enter}",
    );
    expect(onValueChange).toHaveBeenCalledWith("Pacific/Auckland");
  });

  it("walks the list with the arrow keys", async () => {
    const { user, onValueChange } = renderSelect();
    const listbox = await openPicker(user);
    const search = screen.getByPlaceholderText("Search timezones");

    await user.type(search, "europe");
    const [first, second] = within(listbox).getAllByRole("option");
    expect(search).toHaveAttribute("aria-activedescendant", first.id);

    await user.keyboard("{ArrowDown}");
    expect(search).toHaveAttribute("aria-activedescendant", second.id);

    await user.keyboard("{Enter}");
    expect(onValueChange).toHaveBeenCalledWith(zoneOf(second));
  });

  it("says so rather than showing an empty list", async () => {
    const { user } = renderSelect();
    await openPicker(user);
    await user.type(
      screen.getByPlaceholderText("Search timezones"),
      "atlantis",
    );

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No timezone matches that.")).toBeInTheDocument();
  });

  it("keeps a value the runtime does not list selectable", async () => {
    // Node's list carries neither `UTC` nor `Asia/Calcutta` — both are aliases
    // — yet groups are created with `UTC` and browsers do report aliases.
    const { user } = renderSelect("UTC");
    expect(screen.getByRole("combobox")).toHaveTextContent("UTC");

    const listbox = await openPicker(user);
    const utc = within(listbox)
      .getAllByRole("option")
      .find((option) => option.textContent?.startsWith("UTC"));
    expect(utc).toHaveAttribute("aria-selected", "true");
  });
});
