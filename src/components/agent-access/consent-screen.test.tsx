import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../../../messages/en.json";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => {
    const messages = (en as unknown as Record<string, Record<string, string>>)[
      namespace
    ];
    return (key: string, values?: Record<string, unknown>) =>
      new IntlMessageFormat(messages[key] ?? key, "en").format(
        values,
      ) as string;
  },
}));

const { ConsentScreen, ConsentProblem, ConsentRefused } =
  await import("./consent-screen");

/**
 * What a person is shown before they say yes.
 *
 * The screen is a server component and a plain HTML form with no script on it,
 * so the document *is* the behaviour: which fields it posts, to where, and which
 * choices it offers. It is resolved to elements and rendered, then read the way
 * a person would — by role and by label.
 */

const GROUPS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Lisbon trip" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Flat" },
];

async function show(
  overrides: Partial<Parameters<typeof ConsentScreen>[0]> = {},
) {
  const element = await ConsentScreen({
    clientName: "Claude",
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    account: { name: "Ada" },
    groups: GROUPS,
    maxScope: "write",
    sealed: "SEALED.VALUE",
    ...overrides,
  });
  return render(element);
}

describe("the consent screen", () => {
  it("posts its decision to the route that checks it", async () => {
    const { container } = await show();
    const form = container.querySelector("form")!;

    expect(form).toHaveAttribute("method", "post");
    expect(form).toHaveAttribute("action", "/oauth/authorize/decision");
  });

  it("carries the sealed request, and nothing else about it, in the form", async () => {
    const { container } = await show();
    const names = Array.from(container.querySelectorAll("[name]")).map(
      (field) => field.getAttribute("name"),
    );

    expect(
      container.querySelector<HTMLInputElement>('input[name="request"]')!.value,
    ).toBe("SEALED.VALUE");
    // The address the answer goes to is shown, never posted: a form that
    // carried it could be edited to send the code somewhere else.
    expect(names).not.toContain("redirect_uri");
    expect(names).not.toContain("client_id");
    expect(names).not.toContain("code_challenge");
    expect(new Set(names)).toEqual(
      new Set(["request", "scope", "group", "decision"]),
    );
  });

  it("names who is asking, and says that name is only a claim", async () => {
    await show({ clientName: "Claude" });

    expect(
      screen.getByRole("heading", {
        name: "Allow Claude to use your account?",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Balancia has not checked who it really is/),
    ).toBeInTheDocument();
  });

  it("says where the answer will go, in the words of the kind of address it is", async () => {
    const web = await show();
    expect(web.container).toHaveTextContent("claude.ai");
    web.unmount();

    const local = await show({ redirectUri: "http://localhost:3118/callback" });
    expect(local.container).toHaveTextContent(
      "an app running on this computer",
    );
    local.unmount();

    const native = await show({
      redirectUri: "cursor://anysphere.cursor-retrieval/cb",
    });
    expect(native.container).toHaveTextContent(
      "an app on this device (cursor://)",
    );
  });

  it("shows a name that tries to be markup as the text it is", async () => {
    const { container } = await show({
      clientName: '<img src=x onerror="alert(1)">',
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)">');
  });

  it("offers read and write, and starts on the narrower", async () => {
    await show({ maxScope: "write" });

    // Reading is what is selected until a person chooses more. Somebody who
    // presses Allow without reading — or is tricked into it — has given away a
    // view of their groups, and not the ability to write to them.
    expect(screen.getByRole("radio", { name: /Read only/ })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: /Read and make changes/ }),
    ).not.toBeChecked();
  });

  it("offers only to read when that is all the app asked for", async () => {
    await show({ maxScope: "read" });

    expect(
      screen.queryByRole("radio", { name: /Read and make changes/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Read only/ })).toBeChecked();
    expect(screen.getByText(/only asked to read/)).toBeInTheDocument();
  });

  it("lets the person pick one group or all of them", async () => {
    await show();
    const groups = screen.getByRole("combobox", { name: "Which groups" });

    expect(groups).toHaveValue("all");
    const options = within(groups)
      .getAllByRole("option")
      .map((option) => [option.getAttribute("value"), option.textContent]);
    expect(options).toEqual([
      ["all", "All my groups"],
      [GROUPS[0]!.id, "Lisbon trip"],
      [GROUPS[1]!.id, "Flat"],
    ]);
  });

  it("states what the assistant can never do", async () => {
    await show();

    for (const never of [
      "Change your account or how you sign in",
      "Add or remove people, or create invitation links",
      "Export or delete a group",
      "See anybody’s payment details",
    ]) {
      expect(screen.getByText(never)).toBeInTheDocument();
    }
  });

  it("makes Allow and Cancel two answers to one question", async () => {
    await show();

    expect(screen.getByRole("button", { name: "Allow" })).toHaveAttribute(
      "name",
      "decision",
    );
    expect(screen.getByRole("button", { name: "Allow" })).toHaveAttribute(
      "value",
      "allow",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "value",
      "deny",
    );
  });

  it("gives the select the size every field has on a phone", async () => {
    await show();

    // 16px below `md`, so Safari does not zoom in when it takes focus.
    expect(
      screen.getByRole("combobox", { name: "Which groups" }).className,
    ).toMatch(/\btext-base\b/);
  });
});

describe("a connection that cannot go ahead", () => {
  it.each([
    ["unknownClient", "does not recognise the application"],
    ["badRedirect", "an address it had not registered"],
    ["tooMany", "as many connected applications as one account can hold"],
    ["notYourGroup", "is not one of yours"],
    ["expired", "has expired"],
  ] as const)("says why for %s", async (reason, words) => {
    render(await ConsentProblem({ reason }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This connection cannot go ahead",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(words);
    expect(
      screen.getByRole("link", { name: "Go to Balancia" }),
    ).toHaveAttribute("href", "/");
  });
});

describe("a request Balancia could not use", () => {
  async function refused() {
    render(
      await ConsentRefused({
        redirectUri: "https://evil.example/login",
        returnTo:
          "https://evil.example/login?error=invalid_request&iss=https%3A%2F%2Fbalancia.example",
        detail: "invalid_request — A code_challenge is required (PKCE, S256).",
      }),
    );
  }

  it("says what was wrong, and that nothing was shared", async () => {
    await refused();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "cannot use, so nothing was shared",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A code_challenge is required",
    );
  });

  it("gives the way back as a link to follow, and names where it goes", async () => {
    await refused();

    // Not a redirect: with open registration the address is a stranger's claim,
    // and sending the browser there by itself makes this an open redirector.
    const link = screen.getByRole("link", { name: "Return to evil.example" });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining(
        "https://evil.example/login?error=invalid_request",
      ),
    );
  });
});
