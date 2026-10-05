import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * When the sign-in page says a group is private.
 *
 * The group shell sends anybody signed out here with `next=/groups/<id>`, for
 * every id it is given, before it looks anything up. So the line may follow
 * that parameter and nothing else — which is also what keeps it from saying
 * whether the group exists.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    Object.assign((key: string) => key, { has: () => true }),
}));
vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () => null,
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    smtpEnabled: false,
    appleSignInEnabled: false,
    DEMO_MODE: false,
  }),
}));
// A client component with the whole form behind it; what is under test is the
// decision the page hands it.
vi.mock("@/components/auth/sign-in-form", () => ({
  SignInForm: () => null,
}));

const { default: SignInPage } = await import("./page");

/** Whether the page asked the form for the line, given these parameters. */
async function saysPrivate(
  searchParams: Record<string, string | string[] | undefined>,
): Promise<boolean> {
  const page = (await SignInPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(searchParams),
  } as PageProps<"/sign-in">)) as ReactElement<{ privateGroup?: boolean }>;
  return page.props.privateGroup === true;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the private group line", () => {
  it("appears for a reader sent away from a group's page", async () => {
    expect(
      await saysPrivate({
        next: "/groups/7d4f3c2a-1b6e-4c8d-9f0a-2e5b8c7d6a41",
      }),
    ).toBe(true);
  });

  /** Any screen inside a group is still that group's address. */
  it("appears for a screen inside one", async () => {
    expect(await saysPrivate({ next: "/groups/abc/settle" })).toBe(true);
  });

  it("stays away from an ordinary sign-in", async () => {
    expect(await saysPrivate({})).toBe(false);
  });

  it("stays away when the reader came from anywhere else", async () => {
    expect(await saysPrivate({ next: "/dashboard" })).toBe(false);
    expect(await saysPrivate({ next: "/settings/profile" })).toBe(false);
    expect(await saysPrivate({ next: "/groups" })).toBe(false);
    expect(await saysPrivate({ next: "/groups/" })).toBe(false);
  });

  /** A repeated parameter is not something the shell ever writes. */
  it("stays away from a parameter given twice", async () => {
    expect(await saysPrivate({ next: ["/groups/a", "/groups/b"] })).toBe(false);
  });
});
