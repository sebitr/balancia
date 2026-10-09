import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { AgentAccessCard } from "@/components/settings/agent-access-card";
import {
  AgentConnectCard,
  AgentGuide,
} from "@/components/settings/agent-guide";
import { getEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/security/actor";
import { MCP_PATH } from "@/modules/agent-access/constants";
import { listConnections } from "@/modules/agent-access/grants";
import { serializeConnection } from "@/modules/agent-access/serialize";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("assistants") };
}

/**
 * Letting an AI assistant look after the groups, and how.
 *
 * A screen of its own rather than a card on Sign-in & security, which is where
 * it began: that screen is about ways *into* the account, and this one needs
 * room for the part nobody can guess — what to type into Claude, what to ask it
 * afterwards, and how to keep it on a short lead. The connections come first
 * because they are the answer to "what can get in"; the guide follows.
 *
 * On an instance whose operator has switched agent access off the screen does
 * not exist, for the same reason the hub does not list it: there is nothing to
 * connect to, and a page explaining a feature the server refuses would only
 * send people round a loop.
 */
export default async function AssistantsSettingsPage() {
  const env = getEnv();
  if (!env.agentAccessEnabled) notFound();

  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("userSettings");
  const tGuide = await getTranslations("agentGuide");
  const connections = await listConnections(user.userId);

  return (
    <SettingsScreen
      title={t("assistants")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      <p className="shrink-0 px-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
        {tGuide("intro")}
      </p>

      <AgentAccessCard connections={connections.map(serializeConnection)} />

      <AgentConnectCard address={`${env.appOrigin}${MCP_PATH}`} />

      <AgentGuide />
    </SettingsScreen>
  );
}
