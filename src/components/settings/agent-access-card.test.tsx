import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { AgentAccessCard } from "./agent-access-card";
import type { SerializedConnection } from "@/modules/agent-access/serialize";

/**
 * The assistants that are connected, and taking one back.
 *
 * The card never mints anything — Claude and ChatGPT ask the person to sign in
 * on Balancia's own screen, and the connection they end up with simply appears
 * in the list. So most of what is worth asserting is what the card *says*: what
 * each may do and the line that makes a forgotten connection visible.
 * Disconnecting is the one write, and it behaves like revoking an API key:
 * asked first, spoken afterwards, no Undo to offer. How to connect another is
 * the guide beside it (`agent-guide.test.tsx`).
 */

const { disconnectAction, toastSuccess, toastError, refresh } = vi.hoisted(
  () => ({
    disconnectAction: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    refresh: vi.fn(),
  }),
);

vi.mock("@/modules/agent-access/actions", () => ({
  disconnectAgentAction: disconnectAction,
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const CONNECTIONS: SerializedConnection[] = [
  {
    id: "c1",
    clientName: "Claude",
    scope: "write",
    groupId: null,
    groupName: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    lastUsedAt: "2026-10-01T08:30:00.000Z",
  },
  {
    id: "c2",
    clientName: "Cursor",
    scope: "read",
    groupId: "g1",
    groupName: "Lisbon, March",
    createdAt: "2026-09-04T10:00:00.000Z",
    lastUsedAt: null,
  },
];

function renderCard(connections: SerializedConnection[] = CONNECTIONS) {
  disconnectAction.mockReset().mockResolvedValue({ ok: true });
  toastSuccess.mockReset();
  toastError.mockReset();
  refresh.mockReset();
  const view = renderWithIntl(<AgentAccessCard connections={connections} />);
  return { ...view, user: userEvent.setup() };
}

describe("AgentAccessCard", () => {
  it("lists each connection by name, what it may do and where", () => {
    renderCard();

    const rows = within(
      screen.getByRole("list", { name: "Connected assistants" }),
    );
    expect(rows.getByText("Claude")).toBeInTheDocument();
    expect(rows.getByText("Read and write · All groups")).toBeInTheDocument();
    expect(rows.getByText("Cursor")).toBeInTheDocument();
    expect(rows.getByText("Read only · Lisbon, March")).toBeInTheDocument();
  });

  it("says outright when a connection has never been used", () => {
    renderCard();

    // On one added a month ago, "not used yet" means whatever it was added to
    // never got as far as asking. Nobody would otherwise find that out.
    expect(screen.getByText(/not used yet/)).toBeInTheDocument();
    expect(screen.getByText(/last used/)).toBeInTheDocument();
  });

  it("counts them", () => {
    renderCard();
    expect(screen.getByText("2 connected")).toBeInTheDocument();
  });

  it("points a first-time reader at the steps rather than at an empty list", () => {
    renderCard([]);

    expect(
      screen.getByText(/No assistant is connected yet/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Connected assistants" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/connected$/)).not.toBeInTheDocument();
  });

  it("asks before disconnecting, and does nothing until it is answered", async () => {
    const { user } = renderCard();

    await user.click(screen.getByRole("button", { name: "Disconnect Claude" }));

    expect(
      await screen.findByText("Disconnect this assistant?"),
    ).toBeInTheDocument();
    expect(disconnectAction).not.toHaveBeenCalled();

    // The way out says what it keeps, rather than "Cancel".
    await user.click(screen.getByRole("button", { name: "Keep it connected" }));
    expect(
      screen.queryByText("Disconnect this assistant?"),
    ).not.toBeInTheDocument();
    expect(disconnectAction).not.toHaveBeenCalled();
  });

  it("disconnects on confirmation, and says so without offering an Undo", async () => {
    const { user } = renderCard();

    await user.click(screen.getByRole("button", { name: "Disconnect Claude" }));
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(disconnectAction).toHaveBeenCalledWith("c1"));
    // The row has left the screen and there is no control left to press, so
    // this one speaks — with `toast.success`, never `toastUndoable`, because
    // the tokens are hashes and there is nothing to put back.
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Claude disconnected"),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("speaks when the server refuses, and leaves the list alone", async () => {
    const { user } = renderCard();
    disconnectAction.mockResolvedValue({
      ok: false,
      error: "Something went wrong.",
    });

    await user.click(screen.getByRole("button", { name: "Disconnect Cursor" }));
    await user.click(await screen.findByRole("button", { name: "Disconnect" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Something went wrong."),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("tells a reader in French", () => {
    renderWithIntl(<AgentAccessCard connections={CONNECTIONS} />, {
      locale: "fr",
    });

    expect(screen.getByText("Tes assistants")).toBeInTheDocument();
    expect(
      screen.getByText("Lecture et écriture · Tous les groupes"),
    ).toBeInTheDocument();
    expect(screen.getByText("2 connectés")).toBeInTheDocument();
  });
});
