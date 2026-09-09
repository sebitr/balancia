import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { ApiTokensCard } from "./api-tokens-card";
import type { SerializedApiToken } from "@/modules/api-tokens/serialize";

/**
 * Minting a key, and taking one back.
 *
 * The two halves confirm in opposite ways, which is the whole reason this file
 * exists. Creating hands over a secret that will never exist again and puts it
 * in a sheet the reader has to act on — so a toast there would be a slower
 * second copy of a message already under their eyes, and the assertion is that
 * nothing is said. Revoking takes a row off the screen with no control left to
 * press and no way back, so that one does speak, and offers no Undo the server
 * could not honour.
 */

const { createAction, revokeAction, toastSuccess, toastError, refresh } =
  vi.hoisted(() => ({
    createAction: vi.fn(),
    revokeAction: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    refresh: vi.fn(),
  }));

vi.mock("@/modules/api-tokens/actions", () => ({
  createApiTokenAction: createAction,
  revokeApiTokenAction: revokeAction,
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const TOKENS: SerializedApiToken[] = [
  {
    id: "t1",
    name: "Kitchen tablet",
    prefix: "blc_A1b2C3d4",
    scope: "read",
    groupId: null,
    groupName: null,
    createdAt: "2026-08-01T10:00:00.000Z",
    lastUsedAt: "2026-09-01T08:30:00.000Z",
  },
  {
    id: "t2",
    name: "Weekly export",
    prefix: "blc_Z9y8X7w6",
    scope: "write",
    groupId: "g1",
    groupName: "Lisbon, March",
    createdAt: "2026-07-04T10:00:00.000Z",
    lastUsedAt: null,
  },
];

const GROUPS = [
  { id: "g1", name: "Lisbon, March" },
  { id: "g2", name: "Flat" },
];

function renderCard(tokens: SerializedApiToken[] = TOKENS) {
  createAction.mockReset().mockResolvedValue({
    ok: true,
    data: { token: "blc_secretsecretsecret", record: tokens[0] },
  });
  revokeAction.mockReset().mockResolvedValue({ ok: true });
  toastSuccess.mockReset();
  toastError.mockReset();
  refresh.mockReset();
  const view = renderWithIntl(
    <ApiTokensCard tokens={tokens} groups={GROUPS} />,
  );
  return { ...view, user: userEvent.setup() };
}

describe("ApiTokensCard", () => {
  it("lists each key by name, scope and where it may be used", () => {
    renderCard();

    // Scoped to the list: the create form's own scope picker shows the same
    // two words, and this is asserting what the *rows* say.
    const rows = within(screen.getByRole("list"));
    expect(rows.getByText("Kitchen tablet")).toBeInTheDocument();
    expect(rows.getByText("Read only")).toBeInTheDocument();
    expect(rows.getByText("Weekly export")).toBeInTheDocument();
    expect(
      rows.getByText("Read and write · Lisbon, March"),
    ).toBeInTheDocument();
  });

  it("shows the prefix and never a whole key", () => {
    renderCard();

    // Eight characters after `blc_` name the row; the rest of the secret is a
    // hash in a table and cannot be rendered even by mistake.
    expect(screen.getByText("blc_A1b2C3d4…")).toBeInTheDocument();
  });

  it("says outright when a key has never been used", () => {
    renderCard();

    // The line that makes a forgotten key visible: on a key minted in July,
    // "never used" means whatever it was pasted into never worked.
    expect(screen.getByText(/never used/)).toBeInTheDocument();
  });

  it("mints a key and says nothing about it", async () => {
    const { user } = renderCard();

    await user.type(screen.getByLabelText(/What is this key for/), "Cron");
    await user.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => expect(createAction).toHaveBeenCalledOnce());
    expect(createAction).toHaveBeenCalledWith({
      name: "Cron",
      scope: "read",
      groupId: null,
    });
    // The sheet below is the confirmation, and it is holding the only copy of
    // the secret there will ever be.
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("shows the secret once, and says so", async () => {
    const { user } = renderCard();

    await user.type(screen.getByLabelText(/What is this key for/), "Cron");
    await user.click(screen.getByRole("button", { name: "Create key" }));

    expect(
      await screen.findByText("blc_secretsecretsecret"),
    ).toBeInTheDocument();
    expect(screen.getByText(/will not be shown again/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("will not create a key with no name", () => {
    renderCard();

    // A key that turns up in this list a year later as "unnamed" is a key
    // nobody dares revoke, so the button waits for one.
    expect(screen.getByRole("button", { name: "Create key" })).toBeDisabled();
  });

  it("asks before revoking, and does nothing until it is answered", async () => {
    const { user } = renderCard();

    await user.click(
      screen.getByRole("button", { name: "Revoke Kitchen tablet" }),
    );

    expect(await screen.findByText("Revoke this key?")).toBeInTheDocument();
    expect(revokeAction).not.toHaveBeenCalled();
  });

  it("revokes on confirmation, and says so without offering an Undo", async () => {
    const { user } = renderCard();

    await user.click(
      screen.getByRole("button", { name: "Revoke Kitchen tablet" }),
    );
    await user.click(await screen.findByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(revokeAction).toHaveBeenCalledWith("t1"));
    // The row has left the screen and there is no control left to press, so
    // this one speaks — with `toast.success`, never `toastUndoable`, because
    // the server cannot put a revoked key back.
    expect(toastSuccess).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalled();
  });

  it("speaks when a refusal has nowhere else to appear", async () => {
    const { user } = renderCard();
    createAction.mockResolvedValue({
      ok: false,
      error: "Give this key a name.",
    });

    await user.type(screen.getByLabelText(/What is this key for/), "Cron");
    await user.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Give this key a name."),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("invites a first key when there are none", () => {
    renderCard([]);

    expect(screen.getByText(/Give a Shortcut, a script/)).toBeInTheDocument();
  });
});
