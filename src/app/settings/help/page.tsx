import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BookOpen, Bug, Code2, Sparkles } from "lucide-react";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { SettingsGroup } from "@/components/settings/settings-card";
import { InstallRow } from "@/components/pwa/install-row";
import { appVersion } from "@/lib/telemetry/environment";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("help") };
}

/**
 * Where the app came from and where to complain about it.
 *
 * Every row here leaves the instance, so every one is a plain anchor with
 * `rel="noreferrer"` rather than a `Link` — there is nothing to prefetch and
 * nothing of this installation's URLs to hand to the destination.
 *
 * The addresses are the project's, not the deployment's, and they are
 * constants rather than settings: this is Balancia's own source and Balancia's
 * own issue tracker whoever is running it, and an operator who forked it can
 * change these two lines.
 */
const REPOSITORY = "https://github.com/sebitr/balancia";
const HOMEPAGE = "https://balancia.app";

export default async function HelpSettingsPage() {
  const t = await getTranslations("userSettings");

  const links = [
    { href: `${REPOSITORY}/releases`, icon: Sparkles, label: t("whatsNew") },
    { href: `${HOMEPAGE}/docs`, icon: BookOpen, label: t("documentation") },
    { href: `${REPOSITORY}/issues`, icon: Bug, label: t("reportProblem") },
    { href: REPOSITORY, icon: Code2, label: t("sourceCode") },
  ];

  return (
    <SettingsScreen
      title={t("help")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      <SettingsGroup>
        <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-3.5">
          <span className="text-sm font-medium">{t("version")}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {appVersion()}
          </span>
        </div>
      </SettingsGroup>

      <SettingsGroup>
        <div>
          {/* Renders nothing where the app is installed or uninstallable. */}
          <InstallRow />
          {links.map(({ href, icon: Icon, label }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-11 items-center gap-3 px-4 py-3.5 transition-colors not-first:border-t not-first:border-border hover:bg-foreground/4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:-outline-offset-2 focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className="flex size-7.5 shrink-0 items-center justify-center rounded-[10px] bg-foreground/8"
              >
                <Icon className="size-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {label}
              </span>
            </a>
          ))}
        </div>
      </SettingsGroup>

      <p className="shrink-0 px-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
        {t("aboutNote")}
      </p>
    </SettingsScreen>
  );
}
