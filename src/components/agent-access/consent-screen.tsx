import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Bot, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OAUTH_DECISION_PATH } from "@/modules/agent-access/constants";
import { describeRedirect } from "@/modules/agent-access/redirect-uri";
import type { TokenScope } from "@/modules/api-tokens/scope";

/**
 * "Allow this application to use your account?" — the screen that stands
 * between a stranger's request and a code.
 *
 * Everything on it exists to let a person make the decision knowingly, and it
 * is written in the order they would ask the questions: who is asking, what
 * will it be able to do, how much of my money does that reach, and what will it
 * never be able to do. The two choices a person can make — how much, and
 * which group — are the only things on the form that are theirs; everything
 * else rides in the sealed `request` field and is checked again on the way
 * back (see `consent-token.ts`).
 *
 * **Who is asking is the application's own claim.** The name was typed by
 * whatever registered it, so the screen says that in as many words and puts the
 * one thing a stranger cannot borrow — the address the answer will go to —
 * beside it. A server component and a plain HTML form: no script runs here,
 * so there is nothing for an injected one to hook into, and the decision is an
 * ordinary POST the browser can follow to any address, including the custom
 * scheme a desktop application listens on.
 */
export async function ConsentScreen({
  clientName,
  redirectUri,
  account,
  groups,
  maxScope,
  sealed,
}: {
  clientName: string;
  redirectUri: string;
  account: { name: string };
  groups: readonly { id: string; name: string }[];
  maxScope: TokenScope;
  sealed: string;
}) {
  const t = await getTranslations("agentConsent");
  const where = describeRedirect(redirectUri);
  const returnTo =
    where.kind === "web"
      ? t("whereWeb", { host: where.label })
      : where.kind === "local"
        ? t("whereLocal", { host: where.label })
        : t("whereApp", { scheme: where.label });
  const canWrite = maxScope === "write";

  return (
    <form
      method="post"
      action={OAUTH_DECISION_PATH}
      className="space-y-5"
      autoComplete="off"
    >
      <input type="hidden" name="request" value={sealed} />

      <header className="space-y-2">
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-xl bg-wash-3"
        >
          <Bot className="size-5" strokeWidth={1.9} />
        </span>
        <h1 className="font-heading text-xl font-semibold text-balance break-words">
          {t("title", { client: clientName })}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">{t("lead")}</p>
      </header>

      <section
        aria-label={clientName}
        className="space-y-1.5 rounded-xl bg-card p-3.5 text-card-foreground ring-1 ring-foreground/10"
      >
        <p className="text-sm font-medium break-words">{clientName}</p>
        <p className="text-xs text-pretty text-muted-foreground">
          {t("unverified")}
        </p>
        <p className="text-xs text-pretty break-words">
          {t("returnTo", { where: returnTo })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("signedInAs", { name: account.name })}
        </p>
      </section>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold">
          {t("accessTitle")}
        </legend>
        {canWrite && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-foreground/10 has-checked:bg-primary/5 has-checked:ring-2 has-checked:ring-primary">
            <input
              type="radio"
              name="scope"
              value="write"
              className="mt-1 accent-primary"
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">
                {t("accessWrite")}
              </span>
              <span className="block text-xs text-pretty text-muted-foreground">
                {t("accessWriteHint")}
              </span>
            </span>
          </label>
        )}
        <label className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-foreground/10 has-checked:bg-primary/5 has-checked:ring-2 has-checked:ring-primary">
          <input
            type="radio"
            name="scope"
            value="read"
            defaultChecked
            className="mt-1 accent-primary"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium">{t("accessRead")}</span>
            <span className="block text-xs text-pretty text-muted-foreground">
              {t("accessReadHint")}
              {!canWrite && ` ${t("readOnlyAsked")}`}
            </span>
          </span>
        </label>
      </fieldset>

      <div className="space-y-1.5">
        <label htmlFor="agent-group" className="block text-sm font-semibold">
          {t("groupsTitle")}
        </label>
        {/* A native control with the size every text-entry control here has:
            16px on a phone, so Safari does not zoom in when it takes focus. */}
        <select
          id="agent-group"
          name="group"
          defaultValue="all"
          className="h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9 md:text-sm dark:bg-input/30"
        >
          <option value="all">{t("allGroups")}</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </div>

      <section className="space-y-1.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck aria-hidden="true" className="size-4" />
          {t("neverTitle")}
        </h2>
        <ul className="list-disc space-y-0.5 pl-9 text-xs text-muted-foreground">
          <li>{t("neverAccount")}</li>
          <li>{t("neverPeople")}</li>
          <li>{t("neverGroup")}</li>
          <li>{t("neverPayment")}</li>
        </ul>
      </section>

      <p className="text-xs text-pretty text-muted-foreground">
        {t("sharedNote")} {t("manageNote")}
      </p>

      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          name="decision"
          value="allow"
          size="lg"
          className="w-full rounded-xl"
        >
          {t("allow")}
        </Button>
        <Button
          type="submit"
          name="decision"
          value="deny"
          variant="ghost"
          size="lg"
          className="w-full rounded-xl"
        >
          {t("deny")}
        </Button>
      </div>
    </form>
  );
}

/** Why a connection cannot go ahead, said where the person is standing. */
export async function ConsentProblem({
  reason,
}: {
  reason:
    "unknownClient" | "badRedirect" | "tooMany" | "notYourGroup" | "expired";
}) {
  const t = await getTranslations("agentConsent");
  const sentence = {
    unknownClient: t("errorUnknownClient"),
    badRedirect: t("errorBadRedirect"),
    tooMany: t("errorTooMany"),
    notYourGroup: t("errorNotYourGroup"),
    expired: t("errorExpired"),
  }[reason];

  return (
    <div className="space-y-4" role="alert">
      <h1 className="font-heading text-xl font-semibold text-balance">
        {t("errorTitle")}
      </h1>
      <p className="text-sm text-pretty text-muted-foreground">{sentence}</p>
      <Button asChild variant="outline" size="lg" className="rounded-xl">
        <Link href="/">{t("errorBack")}</Link>
      </Button>
    </div>
  );
}

/**
 * A request Balancia could not use, said to the person rather than sent back.
 *
 * Registration is open, so the address a request names is a stranger's claim
 * until a person has allowed that application once. Redirecting there on a
 * fault — the obvious reading of RFC 6749 §4.1.2.1 — would make this server an
 * open redirector: anybody registers `https://evil.example/login`, sends out a
 * link with a malformed request, and the browser lands there straight from
 * Balancia's address with no click and no screen in between. RFC 9700 §4.11.2
 * says not to. So the fault is explained here, and the way back to the
 * application is a link a person chooses to follow, with where it goes written
 * beside it.
 */
export async function ConsentRefused({
  redirectUri,
  returnTo,
  detail,
}: {
  /** Where the application registered, for saying where the link goes. */
  redirectUri: string;
  /** The address with the error on it — what a client reads, if it is let. */
  returnTo: string;
  detail: string;
}) {
  const t = await getTranslations("agentConsent");
  const where = describeRedirect(redirectUri);
  const label =
    where.kind === "web"
      ? t("whereWeb", { host: where.label })
      : where.kind === "local"
        ? t("whereLocal", { host: where.label })
        : t("whereApp", { scheme: where.label });

  return (
    <div className="space-y-4" role="alert">
      <h1 className="font-heading text-xl font-semibold text-balance">
        {t("errorTitle")}
      </h1>
      <p className="text-sm text-pretty text-muted-foreground">
        {t("errorRefused")}
      </p>
      <p className="text-xs break-words text-muted-foreground">
        {t("errorRefusedDetail", { detail })}
      </p>
      <Button asChild variant="outline" size="lg" className="rounded-xl">
        <a href={returnTo}>{t("errorReturn", { where: label })}</a>
      </Button>
    </div>
  );
}
