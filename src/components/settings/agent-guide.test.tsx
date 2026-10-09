import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator } from "use-intl/core";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { renderWithIntl } from "../../../tests/helpers/intl";

/**
 * The guide on the AI assistants screen: how to connect one, what to ask it,
 * how to keep it on a short lead.
 *
 * It is prose, so what is worth pinning is what a reader could not do without —
 * the address already in the command they will paste, the one-way door in the
 * "make changes" step, and the limits of what an assistant is ever given. The
 * components are Server Components, called here and their output mounted.
 */

const state = vi.hoisted(() => ({ locale: "en" as "en" | "fr" }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "agentGuide") =>
    createTranslator({
      locale: state.locale,
      messages: state.locale === "fr" ? fr : en,
      namespace,
    }),
}));

const { AgentConnectCard, AgentGuide } = await import("./agent-guide");

const ADDRESS = "https://balancia.example/mcp";

async function renderConnect(locale: "en" | "fr" = "en") {
  state.locale = locale;
  const card = await AgentConnectCard({ address: ADDRESS });
  return {
    ...renderWithIntl(card, { locale }),
    user: userEvent.setup(),
  };
}

async function renderGuide(locale: "en" | "fr" = "en") {
  state.locale = locale;
  return renderWithIntl(await AgentGuide(), { locale });
}

describe("AgentConnectCard", () => {
  it("opens on the address, with every way of connecting shut", async () => {
    await renderConnect();

    expect(
      screen.getByLabelText("Balancia’s address for assistants"),
    ).toHaveValue(ADDRESS);
    for (const name of [
      "Claude — web, desktop and phone",
      "ChatGPT",
      "Claude Code",
      "Cursor, VS Code and other editors",
    ]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }
    expect(screen.queryByText(/Add custom connector/)).not.toBeInTheDocument();
  });

  it("walks through Claude in order, ending on something to ask", async () => {
    const { user } = await renderConnect();

    await user.click(
      screen.getByRole("button", { name: "Claude — web, desktop and phone" }),
    );

    const steps = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(steps[1]).toHaveTextContent("Add custom connector");
    expect(steps[2]).toHaveTextContent("press Allow");
  });

  it("gives Claude Code its command with the address already in it", async () => {
    const { user } = await renderConnect();

    await user.click(screen.getByRole("button", { name: "Claude Code" }));

    expect(
      screen.getByText(`claude mcp add --transport http balancia ${ADDRESS}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Type \/mcp inside Claude Code/),
    ).toBeInTheDocument();
  });

  it("offers a key only as the second choice, and says it does not expire", async () => {
    const { user } = await renderConnect();

    await user.click(
      screen.getByRole("button", {
        name: "Cursor, VS Code and other editors",
      }),
    );

    const snippet = screen.getByText(/"mcpServers"/);
    expect(JSON.parse(snippet.textContent ?? "")).toEqual({
      mcpServers: {
        balancia: {
          type: "http",
          url: ADDRESS,
          headers: { Authorization: "Bearer blc_…" },
        },
      },
    });
    // Signing in is the first thing the section says; the key is the fallback.
    const text = snippet.closest("div")?.textContent ?? "";
    expect(text.indexOf("sign in to a remote MCP server")).toBeLessThan(
      text.indexOf("only send a header"),
    );
    expect(
      screen.getByText(/does not expire until you revoke it/),
    ).toBeVisible();
  });

  it("is written in French in French", async () => {
    await renderConnect("fr");

    expect(
      screen.getByRole("button", {
        name: "Claude — web, ordinateur et téléphone",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Connecter un assistant")).toBeInTheDocument();
  });
});

describe("AgentGuide", () => {
  it("offers prompts for looking and for doing, and says which needs more", async () => {
    await renderGuide();

    expect(
      screen.getByText("Looking — works on a read-only connection"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Doing — needs “Read and make changes”"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Who owes whom in the Lisbon trip?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/I paid 63\.90 for dinner at Taberna/),
    ).toBeInTheDocument();
  });

  it("states what an assistant can never do", async () => {
    await renderGuide();

    expect(
      screen.getByText(
        /never change your account, add or remove people, create invitation links, export or delete a group/,
      ),
    ).toBeInTheDocument();
    // The one risk the connection cannot remove, said to the person who can.
    expect(
      screen.getByText(/one of them could try to give your assistant orders/),
    ).toBeInTheDocument();
  });

  it("points a read-only connection at the way to write", async () => {
    await renderGuide();

    expect(
      screen.getByText(/it was connected as Read only/),
    ).toBeInTheDocument();
  });

  it("links the full guide off the site, without telling it where from", async () => {
    await renderGuide();

    const link = screen.getByRole("link", { name: "Read the full guide" });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/sebitr/balancia/blob/main/docs/ai-agents.md",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("uses French quotation and spacing in French", async () => {
    await renderGuide("fr");

    expect(screen.getByText("Garder la main")).toBeInTheDocument();
    // «…» takes no-break spaces inside, as the rest of the French copy does,
    // so the text is matched as it is rather than with spaces folded together.
    expect(
      screen.getByText("Agir — demande «\u00a0Lire et modifier\u00a0»", {
        normalizer: (text) => text,
      }),
    ).toBeInTheDocument();
  });
});
