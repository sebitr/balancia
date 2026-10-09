import { getTranslations } from "next-intl/server";
import { BookOpen, ExternalLink } from "lucide-react";
import { REPOSITORY } from "@/lib/public-pages";
import { CopyAddress } from "./copy-address";
import { Disclosure } from "./disclosure";
import { SettingsCard, SettingsGroup } from "./settings-card";

/**
 * How to use the assistant access, written on the screen that manages it.
 *
 * Server components throughout: it is prose, and the only thing that moves is
 * the open/shut of a step list (`Disclosure`, which takes server-rendered
 * children) and the copy button. The words live in the server-only `agentGuide`
 * namespace so that none of them rides in the page payload of every other
 * screen.
 *
 * The order is the order a person asks: how do I connect one, what can I say to
 * it, how do I stay in charge of it, and what do I do when it does not work.
 * The same four are in `docs/ai-agents.md`, which this ends by pointing at.
 */

const STEPS = "list-decimal space-y-1.5 pl-5 text-xs text-pretty";
const PARAGRAPH = "text-xs text-pretty text-muted-foreground";
const CODE =
  "block rounded-md bg-wash-3 px-2 py-1.5 font-mono text-xs text-foreground";

const CLAUDE_STEPS = [
  "claudeStep1",
  "claudeStep2",
  "claudeStep3",
  "claudeStep4",
] as const;
const CHATGPT_STEPS = ["chatgptStep1", "chatgptStep2", "chatgptStep3"] as const;
const LOOKING = ["askLook1", "askLook2", "askLook3", "askLook4"] as const;
const DOING = ["askDo1", "askDo2", "askDo3", "askDo4"] as const;
const CONTROLS = [
  "control1",
  "control2",
  "control3",
  "control4",
  "control5",
  "control6",
] as const;
const TROUBLES = ["trouble1", "trouble2", "trouble3"] as const;

/** The snippet for an editor that can only send a header, not sign in. */
function headerConfig(address: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        balancia: {
          type: "http",
          url: address,
          headers: { Authorization: "Bearer blc_…" },
        },
      },
    },
    null,
    2,
  );
}

/**
 * The address, and one step list per assistant. Collapsed, so the screen opens
 * on what is connected and the four ways of connecting are a tap away rather
 * than a wall.
 */
export async function AgentConnectCard({ address }: { address: string }) {
  const t = await getTranslations("agentGuide");

  return (
    <div className="flex shrink-0 flex-col gap-3">
      <SettingsCard title={t("connectTitle")} description={t("connectLead")}>
        <CopyAddress address={address} />
      </SettingsCard>

      <SettingsGroup>
        <Disclosure label={t("claudeTitle")}>
          <ol className={`${STEPS} text-muted-foreground`}>
            {CLAUDE_STEPS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
        </Disclosure>

        <Disclosure label={t("chatgptTitle")}>
          <ol className={`${STEPS} text-muted-foreground`}>
            {CHATGPT_STEPS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
        </Disclosure>

        <Disclosure label={t("codeTitle")}>
          <ol className={`${STEPS} text-muted-foreground`}>
            <li>
              {t("codeStep1")}
              {/* Wraps at its spaces, and inside the address only when the
                  address alone is wider than the screen. */}
              <code className={`${CODE} mt-1.5 break-words`}>
                {`claude mcp add --transport http balancia ${address}`}
              </code>
            </li>
            <li>{t("codeStep2")}</li>
          </ol>
        </Disclosure>

        <Disclosure label={t("otherTitle")}>
          <div className="space-y-3">
            <p className={PARAGRAPH}>{t("otherSignIn")}</p>
            <p className={PARAGRAPH}>{t("otherKey")}</p>
            <pre className={`${CODE} overflow-x-auto whitespace-pre`}>
              {headerConfig(address)}
            </pre>
            <p className={PARAGRAPH}>{t("otherKeyNote")}</p>
          </div>
        </Disclosure>
      </SettingsGroup>
    </div>
  );
}

/** What to ask, how to stay in charge, and what to do when it does not work. */
export async function AgentGuide() {
  const t = await getTranslations("agentGuide");

  return (
    <>
      <SettingsCard title={t("askTitle")}>
        <div className="space-y-4">
          {(
            [
              [t("askLook"), LOOKING],
              [t("askDo"), DOING],
            ] as const
          ).map(([heading, keys]) => (
            <section key={heading} className="space-y-2">
              <h3 className="text-xs font-semibold">{heading}</h3>
              {/* Written as the sentence a person would type, set apart as
                  something to say rather than something to read. */}
              <ul className="space-y-1.5">
                {keys.map((key) => (
                  <li
                    key={key}
                    className="rounded-lg bg-wash-3 px-3 py-2 text-xs text-pretty"
                  >
                    {t(key)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className={PARAGRAPH}>{t("askNote")}</p>
        </div>
      </SettingsCard>

      <SettingsCard title={t("controlTitle")}>
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-pretty text-muted-foreground">
          {CONTROLS.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </SettingsCard>

      <SettingsCard title={t("troubleTitle")}>
        <ul className="list-disc space-y-1.5 pl-5 text-xs text-pretty text-muted-foreground">
          {TROUBLES.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </SettingsCard>

      {/* Leaves the instance, so a plain anchor and `noreferrer`, as on the
          help screen: nothing to prefetch, and nothing of this installation's
          address to hand to the destination. */}
      <SettingsGroup>
        <a
          href={`${REPOSITORY}/blob/main/docs/ai-agents.md`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 items-center gap-3 px-4 py-3.5 transition-colors hover:bg-wash-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:-outline-offset-2 focus-visible:outline-none"
        >
          <span
            aria-hidden="true"
            className="flex size-7.5 shrink-0 items-center justify-center rounded-[10px] bg-wash-3"
          >
            <BookOpen className="size-4" strokeWidth={1.9} />
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {t("fullGuide")}
          </span>
          <ExternalLink
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        </a>
      </SettingsGroup>
    </>
  );
}
