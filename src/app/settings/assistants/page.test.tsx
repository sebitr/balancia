import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../../messages/en.json";
import fr from "../../../../messages/fr.json";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import type { SerializedConnection } from "@/modules/agent-access/serialize";

/**
 * The AI assistants screen: what is connected, how to connect another, and the
 * guide to using it.
 *
 * It exists only where the operator has left agent access on — the hub does not
 * list it otherwise, and a page explaining a feature the server refuses would
 * only send people round a loop. The page is a Server Component, called here
 * and its output mounted. The connections list and the guide are stand-ins:
 * each has a test of its own, and an async Server Component cannot be mounted
 * inside another one in jsdom, so what is pinned here is what the page hands
 * them.
 */

const state = vi.hoisted(() => ({
  locale: "en" as "en" | "fr",
  enabled: true,
  signedIn: true,
  connections: [] as Array<{
    id: string;
    clientName: string;
    scope: "read" | "write";
    groupId: string | null;
    groupName: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
  }>,
}));

class NotFound extends Error {}

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "userSettings" | "agentGuide") =>
    createTranslator({
      locale: state.locale,
      messages: state.locale === "fr" ? fr : en,
      namespace,
    }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound();
  },
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    agentAccessEnabled: state.enabled,
    appOrigin: "https://balancia.example",
  }),
}));
vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () =>
    state.signedIn
      ? { userId: "u1", name: "Ada", email: "ada@example.com" }
      : null,
}));
vi.mock("@/modules/agent-access/grants", () => ({
  listConnections: async () => state.connections,
}));
vi.mock("@/components/settings/agent-access-card", () => ({
  AgentAccessCard: ({
    connections,
  }: {
    connections: readonly SerializedConnection[];
  }) => (
    <p>{`connections: ${connections.map((c) => c.clientName).join(", ")}`}</p>
  ),
}));
vi.mock("@/components/settings/agent-guide", () => ({
  AgentConnectCard: ({ address }: { address: string }) => (
    <p>{`address: ${address}`}</p>
  ),
  AgentGuide: () => <p>The guide</p>,
}));

const { default: AssistantsPage } = await import("./page");

async function renderPage() {
  const page = (await AssistantsPage()) as ReactElement;
  return renderWithIntl(page, { locale: state.locale });
}

beforeEach(() => {
  state.locale = "en";
  state.enabled = true;
  state.signedIn = true;
  state.connections = [];
});

describe("the AI assistants screen", () => {
  it("is not there where the operator has switched agent access off", async () => {
    state.enabled = false;

    await expect(AssistantsPage()).rejects.toBeInstanceOf(NotFound);
  });

  it("names itself, and goes back to the hub", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "AI assistants" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to settings" }),
    ).toHaveAttribute("href", "/settings");
  });

  it("says what the feature is before anything else", async () => {
    await renderPage();

    expect(
      screen.getByText(/Let Claude, ChatGPT or another assistant/),
    ).toBeInTheDocument();
  });

  it("lists what is connected, then gives the address on this instance", async () => {
    state.connections = [
      {
        id: "c1",
        clientName: "Claude",
        scope: "write",
        groupId: null,
        groupName: null,
        createdAt: new Date("2026-09-01T10:00:00Z"),
        lastUsedAt: null,
      },
    ];

    await renderPage();

    const list = screen.getByText("connections: Claude");
    // `APP_URL` and the path the MCP server answers on, nothing else.
    const address = screen.getByText("address: https://balancia.example/mcp");
    expect(
      list.compareDocumentPosition(address) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("ends on the guide, after the connections and the address", async () => {
    await renderPage();

    const address = screen.getByText(/^address: /);
    const guide = screen.getByText("The guide");
    expect(
      address.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders nothing for a request with nobody signed in", async () => {
    state.signedIn = false;

    expect(await AssistantsPage()).toBeNull();
  });

  it("speaks French in French", async () => {
    state.locale = "fr";

    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Assistants IA" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Laisse Claude, ChatGPT/)).toBeInTheDocument();
  });
});
