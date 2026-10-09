import { getTranslations } from "next-intl/server";
import { SettingsCard } from "@/components/settings/settings-card";
import {
  ProviderMark,
  type ProviderChoice,
} from "@/components/backup/provider-mark";
import type { BackupProvider } from "@/modules/backup/providers";
import { providerTiles } from "@/modules/backup/view";
import { AdminState } from "./state-mark";

/**
 * Administration → which services people on this server can back up to.
 *
 * Read-only. Every row is a statement read from this server's configuration,
 * because that is where the answer lives. An account provider always works:
 * with both halves of its client ID and secret set, everyone gets one button;
 * without them, each person brings an app of their own. Proton Drive is offered
 * when `BACKUP_EXPERIMENTAL_PROVIDERS` is set. A screen cannot write an
 * environment variable, so there is no switch to put beside them — a switch
 * that did nothing, or a stored setting that disagreed with the file, would be
 * worse than a sentence naming the variable.
 *
 * The same page of Settings already 404s for everybody who is not the instance
 * administrator, so nothing here re-checks.
 *
 * The own-server group is always ready: nothing has to be registered for a
 * bucket or a WebDAV address, and Infomaniak is one of those two behind a
 * single tile.
 */

const EXPERIMENTAL_VARIABLE = "BACKUP_EXPERIMENTAL_PROVIDERS";

type Entry = {
  readonly choice: ProviderChoice;
  readonly name: string;
  /** `sharedApp`: one button for everyone. `ownApp`: each person brings theirs. */
  readonly state: "ready" | "sharedApp" | "ownApp" | "off";
  /** For an account provider on `ownApp`: the two settings that would give it a button. */
  readonly variables?: { readonly id: string; readonly secret: string };
};

export async function BackupProvidersCard() {
  const t = await getTranslations("cloudBackup");
  const tiles = new Map(providerTiles().map((tile) => [tile.id, tile]));

  const stateOf = (id: BackupProvider): Entry["state"] => {
    const tile = tiles.get(id);
    if (!tile) return "ready";
    return tile.availability === "available" ? "ready" : "off";
  };

  /** An account provider: always usable, and the question is only whose app. */
  const accountOf = (
    id: "google_drive" | "dropbox" | "onedrive",
    prefix: string,
  ): Pick<Entry, "state" | "variables"> => {
    const tile = tiles.get(id);
    if (tile && tile.availability !== "available") return { state: "off" };
    return tile?.instanceApp
      ? { state: "sharedApp" }
      : {
          state: "ownApp",
          variables: {
            id: `${prefix}_CLIENT_ID`,
            secret: `${prefix}_CLIENT_SECRET`,
          },
        };
  };

  const accounts: Entry[] = [
    {
      choice: "google_drive",
      name: t("where.googleDrive"),
      ...accountOf("google_drive", "BACKUP_GOOGLE"),
    },
    {
      choice: "dropbox",
      name: t("where.dropbox"),
      ...accountOf("dropbox", "BACKUP_DROPBOX"),
    },
    {
      choice: "onedrive",
      name: t("where.oneDrive"),
      ...accountOf("onedrive", "BACKUP_MICROSOFT"),
    },
  ];
  const own: Entry[] = [
    { choice: "s3", name: t("where.s3"), state: "ready" },
    { choice: "webdav", name: t("where.webdav"), state: "ready" },
    { choice: "infomaniak", name: t("where.infomaniak"), state: "ready" },
  ];
  const experimental: Entry[] = [
    {
      choice: "proton_drive",
      name: t("where.proton"),
      state: stateOf("proton_drive"),
    },
  ];

  const groups = [
    { label: t("admin.accounts"), entries: accounts },
    { label: t("admin.own"), entries: own },
    { label: t("admin.experimental"), entries: experimental },
  ];

  return (
    <SettingsCard
      title={t("admin.title")}
      description={t("admin.help")}
      contentClassName="px-0 pt-1 pb-2"
    >
      {groups.map(({ label, entries }) => (
        <section key={label}>
          <h3 className="px-4 pt-3.5 pb-1 text-2xs font-semibold tracking-[0.09em] text-muted-foreground uppercase">
            {label}
          </h3>
          <ul>
            {entries.map((entry) => (
              <li
                key={entry.choice}
                className="relative flex items-center gap-3 px-4 py-2.5 before:absolute before:inset-x-0 before:top-0 before:ml-16 before:border-t before:border-border first:before:hidden"
              >
                <ProviderMark provider={entry.choice} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium text-pretty">
                    {entry.name}
                    {entry.choice === "proton_drive" && (
                      <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-wash-3 px-2 text-2xs font-semibold text-muted-foreground">
                        {t("admin.experimental")}
                      </span>
                    )}
                  </p>
                  <AdminState kind={entry.state === "off" ? "off" : "ready"}>
                    {entry.state === "ready"
                      ? t("admin.ready")
                      : entry.state === "sharedApp"
                        ? t("admin.sharedApp")
                        : entry.state === "ownApp"
                          ? t("admin.ownApp")
                          : t("admin.off")}
                  </AdminState>
                  {entry.variables && (
                    <p className="text-xs text-pretty text-muted-foreground">
                      {t("admin.appHint", entry.variables)}
                    </p>
                  )}
                  {entry.choice === "proton_drive" && entry.state === "off" && (
                    <p className="text-xs text-pretty text-muted-foreground">
                      {t("admin.envHint", { name: EXPERIMENTAL_VARIABLE })}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </SettingsCard>
  );
}
