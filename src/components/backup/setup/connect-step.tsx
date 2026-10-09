"use client";

import { useId } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Check,
  Circle,
  CircleAlert,
  CircleCheck,
  ExternalLink,
} from "lucide-react";
import type { ProviderChoice } from "@/components/backup/provider-mark";
import { Disclosure } from "@/components/settings/disclosure";
import { SettingsCard } from "@/components/settings/settings-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { rovingChoice } from "@/components/ui/roving-choice";
import { cn } from "@/lib/utils";
import { TypedForm } from "./connect-forms";
import {
  formKeyFor,
  type Draft,
  type FormKey,
  type InfomaniakService,
} from "./draft";
import { StepFooter, type FooterAction } from "./fields";
import { providerName, useOutcomeText } from "./outcome";
import { OwnAppForm } from "./own-app-form";
import { OAUTH_KIND, oauthStartHref } from "./setup-url";
import type { SetupPending } from "./types";

type OAuthProvider = keyof typeof OAUTH_KIND;

function isOAuthProvider(choice: ProviderChoice): choice is OAuthProvider {
  return choice in OAUTH_KIND;
}

/**
 * Step 3: connecting to the place chosen, which takes one of four shapes.
 *
 *  - an account (Google Drive, Dropbox, OneDrive): a trip to the provider and
 *    back — one button where the server has an app of its own, and otherwise
 *    the client ID and secret of one the person registered;
 *  - an S3-compatible bucket, or a WebDAV server: a form;
 *  - Proton Drive: a form that says it is experimental;
 *  - Infomaniak: first which of its two services, then that service's form.
 *
 * Whatever the shape, Continue is off until something has proved the
 * connection works — the return from the provider, or a passed test.
 */
export function ConnectStep({
  provider,
  draft,
  connection,
  outcome,
  account,
  otherAccountHref,
  onInfomaniak,
  onForm,
  onTest,
  secondary,
  onContinue,
  busy,
}: {
  provider: ProviderChoice;
  draft: Draft;
  /** The connection the OAuth return made, for this provider. */
  connection: SetupPending | null;
  /** What the trip said, if it said anything. */
  outcome: string | null;
  /**
   * What this server has for an account provider: whether an app was
   * registered for everybody, and the address to register for one's own.
   */
  account: { instanceApp: boolean; redirectUri: string | null };
  /** This step again, without the connection: where "another account" goes. */
  otherAccountHref: string;
  onInfomaniak: (service: InfomaniakService) => void;
  onForm: (key: FormKey, patch: Record<string, unknown>) => void;
  onTest: () => void;
  secondary: FooterAction;
  onContinue: () => void;
  busy: boolean;
}) {
  const t = useTranslations("cloudBackup");
  const name = providerName(provider);
  const formKey = formKeyFor(provider, draft.infomaniak);
  const oauth = isOAuthProvider(provider);

  const ready = oauth
    ? connection !== null
    : formKey !== null && draft.test.status === "passed";
  const hint =
    !oauth && formKey !== null && !ready ? t("connect.testNeeded") : undefined;

  return (
    <>
      <h2 className="px-1.5 font-heading text-base font-semibold">
        {t("connect.title", { provider: name })}
      </h2>

      {oauth ? (
        <OAuthPanel
          provider={provider}
          connection={connection}
          outcome={outcome}
          instanceApp={account.instanceApp}
          redirectUri={account.redirectUri}
          otherAccountHref={otherAccountHref}
        />
      ) : (
        <>
          {provider === "infomaniak" && (
            <InfomaniakChoice
              value={draft.infomaniak}
              onChange={onInfomaniak}
            />
          )}
          {formKey && (
            <TypedForm
              formKey={formKey}
              forms={draft.forms}
              provider={name}
              test={draft.test}
              onChange={onForm}
              onTest={onTest}
            />
          )}
        </>
      )}

      <StepFooter
        secondary={secondary}
        primary={{
          label: t("setup.continue"),
          onClick: onContinue,
          disabled: !ready,
          pending: busy,
        }}
        hint={hint}
      />
    </>
  );
}

/**
 * Where an OAuth return leaves the person: at the provider's own words, in a
 * notice above the same card, ready to try again.
 */
function OAuthNotice({ code, provider }: { code: string; provider: string }) {
  const t = useTranslations("cloudBackup");
  const words = useOutcomeText(provider);

  let title = t("connect.testFail");
  let body: string;
  let hint: string | null = null;
  switch (code) {
    case "denied":
      title = t("connect.deniedTitle");
      body = t("connect.denied", { provider });
      break;
    case "failed":
      body = t("connect.failed", { provider });
      break;
    case "expired":
      body = t("connect.expired");
      break;
    case "unavailable":
      body = t("connect.unavailable", { provider });
      break;
    default: {
      const text = words(code);
      body = text.sentence;
      hint = text.hint;
    }
  }

  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {body}
        {hint && <> {hint}</>}
      </AlertDescription>
    </Alert>
  );
}

/** "Google Drive · name@example.com" → "name@example.com", or nothing. */
function accountOf(label: string): string {
  const at = label.indexOf(" · ");
  return at === -1 ? "" : label.slice(at + 3).trim();
}

/**
 * An account provider, in its two states.
 *
 * Not connected: where the server has an app of its own, one button and, folded
 * under it, the way to use an app of one's own; where it has none, the form for
 * one's own app, with nothing folded because there is nothing else to do.
 * Connected: who, and a way back to the same choice for another account.
 */
function OAuthPanel({
  provider,
  connection,
  outcome,
  instanceApp,
  redirectUri,
  otherAccountHref,
}: {
  provider: OAuthProvider;
  connection: SetupPending | null;
  outcome: string | null;
  instanceApp: boolean;
  redirectUri: string | null;
  otherAccountHref: string;
}) {
  const t = useTranslations("cloudBackup");
  const name = providerName(provider);
  // A plain link, and on purpose. `next/link` prefetches, and a prefetch of
  // this address would start the flow; a form post or a fetch is blocked by
  // the page's `form-action 'self'` the moment the answer redirects to the
  // provider. Only a navigation may go there.
  const href = oauthStartHref(provider);
  const account = connection ? accountOf(connection.label) : "";

  const notYet = (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Circle aria-hidden="true" className="size-3.5 shrink-0" />
      {t("connect.notYet")}
    </p>
  );

  return (
    <>
      {outcome && !connection && <OAuthNotice code={outcome} provider={name} />}
      <SettingsCard contentClassName={connection ? undefined : "p-0"}>
        {connection ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 text-sm font-medium text-pretty">
              <CircleCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              {account
                ? t("connect.connectedAs", { provider: name, account })
                : t("connect.connected", { provider: name })}
            </p>
            <ul className="space-y-1 text-xs text-pretty text-muted-foreground">
              <li>{t("connect.scope")}</li>
              <li>{t("connect.folder")}</li>
            </ul>
            <Link
              href={otherAccountHref}
              className={cn(
                buttonVariants({ variant: "link" }),
                "-mx-1 w-fit px-1",
              )}
            >
              {t("connect.otherAccount")}
            </Link>
          </div>
        ) : instanceApp ? (
          <>
            <div className="space-y-3.5 p-4">
              <p className="text-sm text-pretty text-muted-foreground">
                {t("connect.oauthIntro", { provider: name })}
              </p>
              <a
                href={href}
                className={cn(
                  buttonVariants(),
                  // A long name in a longer language wraps rather than spilling
                  // out of a button the width of the phone.
                  "h-auto min-h-11 w-full py-2 text-center whitespace-normal md:h-auto md:min-h-8 lg:w-auto",
                )}
              >
                {t("connect.oauthButton", { provider: name })}
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
              {notYet}
            </div>
            <Disclosure label={t("connect.ownAppTitle", { provider: name })}>
              <OwnAppForm
                provider={provider}
                name={name}
                redirectUri={redirectUri}
                explain={false}
              />
            </Disclosure>
          </>
        ) : (
          <div className="space-y-3.5 p-4">
            <OwnAppForm
              provider={provider}
              name={name}
              redirectUri={redirectUri}
              explain
            />
            {notYet}
          </div>
        )}
      </SettingsCard>
    </>
  );
}

const SERVICES = ["kdrive", "swiss"] as const;

/** Infomaniak is two products behind one name, and they are reached differently. */
function InfomaniakChoice({
  value,
  onChange,
}: {
  value: InfomaniakService | null;
  onChange: (service: InfomaniakService) => void;
}) {
  const t = useTranslations("cloudBackup");
  const labelId = useId();
  const roving = rovingChoice<InfomaniakService>({
    values: SERVICES,
    selected: value,
    onSelect: onChange,
  });

  const rows: Record<InfomaniakService, { title: string; help: string }> = {
    kdrive: {
      title: t("connect.infomaniakKdrive"),
      help: t("connect.infomaniakKdriveHelp"),
    },
    swiss: {
      title: t("connect.infomaniakSwiss"),
      help: t("connect.infomaniakSwissHelp"),
    },
  };

  return (
    <div className="space-y-2">
      <p id={labelId} className="px-1.5 text-xs font-semibold">
        {t("connect.infomaniakTitle")}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
      >
        {SERVICES.map((service) => {
          const selected = value === service;
          return (
            <button
              key={service}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-labelledby={`${labelId}-${service}`}
              onClick={() => onChange(service)}
              {...roving(service)}
              className={cn(
                "tap-target relative flex min-h-14 w-full items-center gap-3 border-t border-border px-4 py-3 text-left transition-colors first:border-t-0",
                "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:-outline-offset-2 focus-visible:outline-none",
                selected ? "bg-primary/10" : "hover:bg-wash-1",
              )}
            >
              <span className="min-w-0 flex-1">
                <span
                  id={`${labelId}-${service}`}
                  className="block text-sm font-medium"
                >
                  {rows[service].title}
                </span>
                <span className="block text-xs text-pretty text-muted-foreground">
                  {rows[service].help}
                </span>
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border border-input",
                  selected &&
                    "border-primary bg-primary text-primary-foreground",
                )}
              >
                {selected && <Check className="size-3.5" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
