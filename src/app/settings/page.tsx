import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "@/components/settings/settings-screen";
import {
  loadSettingsHub,
  SettingsHub,
} from "@/components/settings/settings-hub";
import { getCurrentUser } from "@/lib/security/actor";
import AccountSettingsPage from "./account/page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("title") };
}

/**
 * The settings hub.
 *
 * On a phone, a screen of rows, each carrying the value it leads to — see
 * `SettingsHub` for why the values are the point. It names itself and offers
 * the way out of settings, the ✕, and every row pushes its screen over it.
 *
 * From `lg` up the hub is not a screen at all: the surface draws it as the
 * left pane beside every settings screen (`./layout.tsx`), and this page's own
 * copy is hidden. What it shows in the right pane instead is the hub's first
 * screen, the account the rest belong to, so a window opened on `/settings`
 * starts on something rather than on an empty half — and the identity card at
 * the top of the pane is lit to say which screen that is (`HubLink` names the
 * same one). The account screen is rendered as it is at its own address,
 * through its own page, so there is one of it.
 */
export default async function SettingsHubPage(props: PageProps<"/settings">) {
  const user = await getCurrentUser();
  // The layout redirected an unauthenticated caller; this narrows the type.
  if (!user) return null;

  const [t, hub] = await Promise.all([
    getTranslations("userSettings"),
    loadSettingsHub(user.userId),
  ]);

  return (
    <>
      <div className="lg:hidden">
        <SettingsScreen title={t("title")} close={{ label: t("close") }}>
          <SettingsHub user={user} hub={hub} />
        </SettingsScreen>
      </div>
      <div className="hidden lg:block">
        <AccountSettingsPage {...props} />
      </div>
    </>
  );
}
