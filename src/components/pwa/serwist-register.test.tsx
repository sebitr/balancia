import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { usePushSubscription } from "@/components/notifications/use-push-subscription";
import { SerwistRegister, registerServiceWorker } from "./serwist-register";

/**
 * Where the service worker is registered, and where it is not.
 *
 * Registering it installs a precache of every build chunk under the size line
 * in `serwist.config.mjs` — a few megabytes, fetched in the background. That
 * is the offline screen and the entry form with no signal for somebody using
 * the app, and a strange thing to do to a visitor reading the homepage or to
 * somebody who has opened a join link and not said yes yet. So the root layout
 * does not register it; the app's own shells do.
 */

/**
 * A browser's `navigator.serviceWorker`, as far as these tests reach into it:
 * `ready` settles once something has registered, and not before — which is
 * what makes a forgotten registration hang rather than fail.
 */
function fakeServiceWorker() {
  let settle: (registration: unknown) => void = () => {};
  const registration = {
    pushManager: {
      getSubscription: vi.fn().mockResolvedValue(null),
      subscribe: vi.fn().mockResolvedValue({
        endpoint: "https://push.example/1",
        toJSON: () => ({ endpoint: "https://push.example/1" }),
        unsubscribe: vi.fn(),
      }),
    },
  };
  const container = {
    ready: new Promise((resolve) => {
      settle = resolve;
    }),
    register: vi.fn(async () => {
      settle(registration);
      return registration;
    }),
    getRegistration: vi.fn().mockResolvedValue(undefined),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    value: container,
    configurable: true,
  });
  return container;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("registerServiceWorker", () => {
  it("registers the built worker over the whole origin in a production build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const worker = fakeServiceWorker();

    render(<SerwistRegister />);
    await act(async () => {});

    expect(worker.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("leaves a development build alone, which has no worker to register", async () => {
    const worker = fakeServiceWorker();

    await registerServiceWorker();

    expect(worker.register).not.toHaveBeenCalled();
  });
});

describe("turning push on", () => {
  it("registers the worker itself when no screen of the app has yet", async () => {
    // The onboarding checklist offers push before the reader has reached any
    // shell that registers the worker. Waiting on `ready` there, with nothing
    // registered, would leave the switch spinning for ever.
    vi.stubEnv("NODE_ENV", "production");
    const worker = fakeServiceWorker();
    vi.stubGlobal("PushManager", function PushManager() {});
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission: vi.fn().mockResolvedValue("granted"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/push/key"
          ? Response.json({ publicKey: "BAAA" })
          : new Response(null, { status: 201 }),
      ),
    );

    const { result } = renderHook(() => usePushSubscription());
    let enabled = false;
    await act(async () => {
      enabled = await result.current.enable();
    });

    expect(worker.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(enabled).toBe(true);
    expect(result.current.status).toBe("on");
  });
});

/**
 * The files a URL's first render is built from, following static imports.
 *
 * Read with a regular expression rather than a parser: it only has to find
 * where `<SerwistRegister` is written, and over-reaching — following an import
 * that is only a type — can only make it stricter.
 */
function reachableFrom(entries: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, specifier] of source.matchAll(
      /(?:from|import)\s*\(?\s*["'](@\/[^"']+|\.{1,2}\/[^"']+)["']/g,
    )) {
      const base = specifier.startsWith("@/")
        ? path.join("src", specifier.slice(2))
        : path.join(path.dirname(file), specifier);
      const found = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(
        (candidate) => existsSync(candidate),
      );
      if (found) pending.push(found);
    }
  }
  return seen;
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return /^(page|layout)\.tsx$/.test(entry.name) ? [full] : [];
  });
}

describe("where the worker is registered", () => {
  it("is not registered by the homepage or by a join link", () => {
    const visitor = reachableFrom([
      "src/app/layout.tsx",
      "src/app/page.tsx",
      ...routeFiles("src/app/join"),
    ]);
    const mounting = [...visitor].filter((file) =>
      /<SerwistRegister\b/.test(readFileSync(file, "utf8")),
    );

    expect(mounting).toEqual([]);
  });

  it("is registered by the app's shells, the group's included", () => {
    const mounts = (file: string) =>
      /<SerwistRegister\b/.test(readFileSync(file, "utf8"));

    expect(mounts("src/components/layout/app-shell.tsx")).toBe(true);
    expect(mounts("src/app/settings/layout.tsx")).toBe(true);
    // The group layout reaches it through the shell, guests included.
    expect(
      reachableFrom(["src/app/groups/[groupId]/layout.tsx"]).has(
        "src/components/layout/app-shell.tsx",
      ),
    ).toBe(true);
  });
});
