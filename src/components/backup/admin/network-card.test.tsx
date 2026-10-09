import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../../messages/en.json";
import { BackupNetworkCard } from "./network-card";

/**
 * Administration → whether backups may reach this server's own network.
 *
 * A statement with the variable named, because the setting is read from the
 * environment and a screen cannot write it. Its state is a word and an icon,
 * and the warning is plain text.
 */

const env = vi.hoisted(() => ({ allowed: false }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "cloudBackup") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ BACKUP_ALLOW_PRIVATE_ENDPOINTS: env.allowed }),
}));

async function renderCard() {
  return render(await BackupNetworkCard());
}

beforeEach(() => {
  env.allowed = false;
});

describe("the local network card", () => {
  it("says what the setting is, what it allows and what it costs", async () => {
    await renderCard();

    expect(screen.getByText("Local network")).toBeInTheDocument();
    expect(
      screen.getByText("Allow backups to servers on the local network"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Lets people back up to a NAS or a Nextcloud on your own network.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "When this is on, any user can make this server connect to internal addresses.",
      ),
    ).toBeInTheDocument();
  });

  it("says Off, in words, by default", async () => {
    await renderCard();

    const state = screen.getByText("Off");
    expect(state.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("On")).toBeNull();
  });

  it("says On, in words, when the variable is set", async () => {
    env.allowed = true;

    await renderCard();

    const state = screen.getByText("On");
    expect(state.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByText("Off")).toBeNull();
  });

  it("names the variable that moves it, and offers no switch", async () => {
    await renderCard();

    expect(
      screen.getByText("Set with BACKUP_ALLOW_PRIVATE_ENDPOINTS."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
