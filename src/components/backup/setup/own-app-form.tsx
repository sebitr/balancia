"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { REPOSITORY } from "@/lib/public-pages";
import { cn } from "@/lib/utils";
import { beginOwnAppConnectionAction } from "@/modules/backup/actions";
import { SecretField, TextField } from "./fields";
import { useOutcomeText } from "./outcome";

/**
 * Connecting through an app of the person's own: a client ID and a secret, and
 * then the same trip to the provider as the one-button way.
 *
 * Why this exists. A server can only offer one button if its operator has
 * registered an app with Google, Dropbox and Microsoft, and put their secrets
 * in its environment — which most people running Balancia will not do, and
 * which makes everyone on the server share one app's quota and one point of
 * revocation. Letting each owner bring their own means nothing has to be set
 * up by anyone else, and a backup stops only if its owner's app does.
 *
 * What is typed here is posted once, sealed in a cookie for the length of the
 * trip, and stored with the connection the provider's answer makes. It goes in
 * neither the address nor the page's own memory beyond this form.
 */

const COPIED_MS = 2000;
export type OwnAppProvider = "google_drive" | "dropbox" | "onedrive";

export function OwnAppForm({
  provider,
  name,
  redirectUri,
  explain,
}: {
  provider: OwnAppProvider;
  /** The provider's name, for the sentences. */
  name: string;
  /** This server's address for the provider to send the person back to. */
  redirectUri: string | null;
  /** Say why there is a form and not a button: the server has no app of its own. */
  explain: boolean;
}) {
  const t = useTranslations("cloudBackup");
  const words = useOutcomeText(name);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    sentence: string;
    hint: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // The provider's own words for the two values, because they are what its
  // console shows and what the person is looking for there.
  const labels =
    provider === "google_drive"
      ? {
          id: t("connect.ownAppIdGoogle"),
          secret: t("connect.ownAppSecretGoogle"),
          note: t("connect.ownAppNoteGoogle"),
        }
      : provider === "dropbox"
        ? {
            id: t("connect.ownAppIdDropbox"),
            secret: t("connect.ownAppSecretDropbox"),
            note: t("connect.ownAppNoteDropbox"),
          }
        : {
            id: t("connect.ownAppIdMicrosoft"),
            secret: t("connect.ownAppSecretMicrosoft"),
            note: t("connect.ownAppNoteMicrosoft"),
          };

  const complete = clientId.trim() !== "" && clientSecret.trim() !== "";

  const copy = async () => {
    if (!redirectUri) return;
    try {
      await navigator.clipboard.writeText(redirectUri);
    } catch {
      // The address stays on screen, selectable, which is the fallback.
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  };

  const submit = async () => {
    if (!complete || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await beginOwnAppConnectionAction({
        provider,
        clientId,
        clientSecret,
      });
      if (result.ok && result.data?.ok) {
        // A navigation and nothing else: a form or a fetch would be refused by
        // the page's `form-action 'self'` the moment it is sent to the
        // provider. The button stays busy until the page goes.
        window.location.assign(result.data.value.url);
        return;
      }
      setError(
        result.ok && result.data && !result.data.ok
          ? words(result.data.code)
          : { sentence: result.error ?? words(null).sentence, hint: null },
      );
    } catch {
      setError({ sentence: words(null).sentence, hint: null });
    }
    setBusy(false);
  };

  return (
    <form
      noValidate
      className="space-y-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset
        disabled={busy}
        className="m-0 min-w-0 space-y-3.5 border-0 p-0"
      >
        <p className="text-xs text-pretty text-muted-foreground">
          {explain
            ? t("connect.ownAppRequired", { provider: name })
            : t("connect.ownAppIntro", { provider: name })}
        </p>

        {redirectUri && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold">
              {t("connect.ownAppRedirect")}
            </p>
            <code className="block rounded-[10px] bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed break-all select-all">
              {redirectUri}
            </code>
            <p className="text-xs text-pretty text-muted-foreground">
              {t("connect.ownAppRedirectHelp", { provider: name })}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void copy()}
            >
              {copied ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
              {copied ? t("key.copied") : t("key.copy")}
            </Button>
          </div>
        )}

        <p className="text-xs text-pretty text-muted-foreground">
          {labels.note}
        </p>

        <TextField
          label={labels.id}
          value={clientId}
          onChange={setClientId}
          required
        />
        <SecretField
          label={labels.secret}
          help={t("connect.ownAppSecretHelp")}
          value={clientSecret}
          onChange={setClientSecret}
          required
        />

        {error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              {error.sentence}
              {error.hint && <> {error.hint}</>}
            </AlertDescription>
          </Alert>
        )}

        <Button
          type="submit"
          disabled={!complete}
          className="h-auto min-h-11 w-full py-2 text-center whitespace-normal md:h-auto md:min-h-8 lg:w-auto"
        >
          {busy ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : null}
          {t("connect.ownAppContinue", { provider: name })}
          {!busy && <ExternalLink aria-hidden="true" className="size-4" />}
        </Button>
      </fieldset>

      <a
        href={`${REPOSITORY}/blob/main/docs/cloud-backup.md#use-your-own-app`}
        target="_blank"
        rel="noreferrer"
        className={cn(buttonVariants({ variant: "link" }), "-mx-1 w-fit px-1")}
      >
        {t("connect.ownAppGuide")}
        <ExternalLink aria-hidden="true" className="size-4" />
      </a>
    </form>
  );
}
