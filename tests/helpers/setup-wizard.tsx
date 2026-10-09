import { useEffect, useState } from "react";
import type { Mock } from "vitest";
import type { ProviderTile } from "@/modules/backup/view";
import {
  resolveSetup,
  type SetupFacts,
} from "@/components/backup/setup/resolve";
import { SetupWizard } from "@/components/backup/setup/setup-wizard";
import type { SetupGroup } from "@/components/backup/setup/types";

/**
 * Stands in for the page and the router in the wizard's tests.
 *
 * The real thing is a server page that reads the address, decides which step
 * it may be at (`resolveSetup`) and re-renders the same client component with
 * new props when `router.push` moves the address. This does exactly that, with
 * the real `resolveSetup`, so a test walks the steps the way a person does and
 * the draft survives the way it does in the browser: the component keeps its
 * place in the tree while its props change underneath it.
 *
 * Lives here and not beside the components because the rule that checks which
 * messages each Client Component can reach (`client-messages.test.ts`) reads
 * every file under `src` that is not a test, and a file that renders the wizard
 * with no page above it is, to that rule, a screen with no messages.
 *
 * Not imported by anything in the app.
 */

export interface RouterMock {
  push: Mock;
  replace: Mock;
  refresh: Mock;
}

const ROUTE_OF: Partial<Record<ProviderTile["id"], string>> = {
  google_drive: "google",
  dropbox: "dropbox",
  onedrive: "microsoft",
};

export const TILES: readonly ProviderTile[] = [
  tile("google_drive", "oauth"),
  tile("dropbox", "oauth"),
  tile("onedrive", "oauth"),
  tile("s3", "credentials"),
  tile("webdav", "credentials"),
  { ...tile("proton_drive", "credentials"), experimental: true },
];

/** By default the operator registered every app, so an account is one button. */
export function tile(
  id: ProviderTile["id"],
  kind: ProviderTile["kind"],
  overrides: Partial<ProviderTile> = {},
): ProviderTile {
  const route = ROUTE_OF[id];
  return {
    id,
    kind,
    experimental: false,
    availability: "available",
    instanceApp: kind === "oauth",
    redirectUri: route
      ? `https://balancia.example.com/api/backup/oauth/${route}/callback`
      : null,
    ...overrides,
  };
}

export const GROUPS: readonly SetupGroup[] = [
  group("g1", "Lisbon, March", 4, "2026-09-12T10:00:00.000Z"),
  group("g2", "Flat", 3, "2026-10-01T10:00:00.000Z"),
  group("g3", "Ski week", 6, null),
];

export function group(
  id: string,
  name: string,
  participantCount = 2,
  lastActivityAt: string | null = null,
): SetupGroup {
  return { id, name, participantCount, lastActivityAt };
}

export function facts(overrides: Partial<SetupFacts> = {}): SetupFacts {
  return {
    hasKey: true,
    destinations: [],
    pending: null,
    providers: TILES,
    ...overrides,
  };
}

export function WizardHarness({
  facts: current,
  providers = TILES,
  ownedGroups = GROUPS,
  url: first,
  router,
}: {
  /** Read on every render, so a test can change what the server would say. */
  facts: SetupFacts;
  providers?: readonly ProviderTile[];
  ownedGroups?: readonly SetupGroup[];
  url: string;
  router: RouterMock;
}) {
  const [url, setUrl] = useState(first);

  useEffect(() => {
    const follow = (next: string) => setUrl(next);
    router.push.mockImplementation(follow);
    router.replace.mockImplementation(follow);
  }, [router]);

  const query = Object.fromEntries(
    new URL(url, "http://localhost").searchParams,
  );
  const resolution = resolveSetup(current, query);
  if (resolution.kind !== "ok") {
    return <p data-testid="resolution">{resolution.kind}</p>;
  }
  return (
    <SetupWizard
      {...resolution.state}
      providers={providers}
      ownedGroups={ownedGroups}
    />
  );
}
