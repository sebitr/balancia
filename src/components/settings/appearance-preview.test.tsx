import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { AppearancePreview } from "./appearance-preview";

describe("AppearancePreview", () => {
  it("says settled as a phrase, never as a signed zero", () => {
    renderWithIntl(<AppearancePreview currency="EUR" />);

    expect(screen.getByText("Settled up")).toBeVisible();
    expect(screen.queryByText(/0\.00/)).not.toBeInTheDocument();
    expect(screen.getAllByText("−")).toHaveLength(1);
  });
});
