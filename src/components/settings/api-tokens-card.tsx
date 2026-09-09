"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useDateFormatter } from "@/i18n/format-context";
import { Check, Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmSheet } from "./confirm-sheet";
import {
  createApiTokenAction,
  revokeApiTokenAction,
} from "@/modules/api-tokens/actions";
import type { SerializedApiToken } from "@/modules/api-tokens/serialize";
import type { TokenScope } from "@/modules/api-tokens/scope";

/**
 * The keys this account has handed to its own software.
 *
 * Sibling of `PasskeysCard`, and shaped like it, but the two are opposites in
 * one way worth stating: a passkey is added by a ceremony the browser runs and
 * named after the device that made it, while a key here is *created* by this
 * screen and has no identity at all until somebody types one. So this card
 * asks for a name up front, where the passkey card deliberately does not —
 * a key that turns up in a list a year later as "unnamed" is a key nobody
 * dares revoke.
 *
 * Server Actions rather than fetch, which is what stops a key minting a key:
 * `getCurrentActor()` does not read bearer headers and never will. The list is
 * rendered by the server page and refreshed with `router.refresh()`, so there
 * is no second copy of it in a query cache to go stale.
 *
 * **Creating says nothing.** The sheet holding the secret is the confirmation,
 * and it is the only time that value will ever exist — a toast on top of it
 * would be a slower second copy of a message the reader is already staring at.
 * **Revoking asks first**, because it cannot be taken back: putting a key back
 * would mean either storing the secret, which this design refuses to do, or
 * minting a different one, which leaves whatever held the old key just as
 * broken. The doctrine is at `toastUndoable` in `components/ui/sonner.tsx`.
 */
export function ApiTokensCard({
  tokens,
  groups,
}: {
  tokens: readonly SerializedApiToken[];
  /** The groups this account is in, for the optional pin. */
  groups: readonly { id: string; name: string }[];
}) {
  const t = useTranslations("apiTokens");
  const dates = useDateFormatter();
  const router = useRouter();

  const [name, setName] = useState("");
  const [scope, setScope] = useState<TokenScope>("read");
  const [groupId, setGroupId] = useState<string>("all");
  const [pending, startTransition] = useTransition();
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<SerializedApiToken | null>(null);

  const onCreate = () => {
    startTransition(async () => {
      const result = await createApiTokenAction({
        name,
        scope,
        groupId: groupId === "all" ? null : groupId,
      });
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t("createFailed"));
        return;
      }
      // No success toast: the sheet below *is* the confirmation, and it is
      // holding the one copy of the secret there will ever be.
      setMinted(result.data.token);
      setName("");
      setScope("read");
      setGroupId("all");
      router.refresh();
    });
  };

  const onRevoke = (token: SerializedApiToken) => {
    startTransition(async () => {
      const result = await revokeApiTokenAction(token.id);
      setRevoking(null);
      if (!result.ok) {
        toast.error(result.error ?? t("revokeFailed"));
        return;
      }
      // The row has left the screen and there is no control left to press, so
      // this one does say what happened — and offers no Undo, because the
      // server has none to honour.
      toast.success(t("revokedToast", { name: token.name }));
      router.refresh();
    });
  };

  const onCopy = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted);
      setCopied(true);
    } catch {
      // A browser that refuses the clipboard leaves the value on screen and
      // selectable, which is the fallback rather than an error worth a toast.
      setCopied(false);
    }
  };

  const scopeLabel = (value: TokenScope) =>
    value === "write" ? t("scopeWrite") : t("scopeRead");

  return (
    <section className="shrink-0 overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10">
      <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
        <h2 className="font-heading text-base font-semibold">{t("title")}</h2>
        {tokens.length > 0 && (
          <span className="inline-flex h-5.5 items-center rounded-full bg-positive/15 px-2 text-2xs font-semibold text-positive-ink">
            {t("keyCount", { count: tokens.length })}
          </span>
        )}
      </div>

      {tokens.length === 0 ? (
        <p className="flex items-start gap-2.5 px-4 pb-4 text-xs text-pretty text-muted-foreground">
          <KeyRound aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {t("emptyDescription")}
        </p>
      ) : (
        <ul>
          {tokens.map((token) => (
            <li
              key={token.id}
              className="flex items-center gap-3 border-t border-border px-4 py-3"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-wash-3"
              >
                <KeyRound className="size-4" strokeWidth={1.9} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {token.name}
                  </span>
                  <span className="shrink-0 text-2xs text-muted-foreground">
                    {scopeLabel(token.scope)}
                    {token.groupName ? ` · ${token.groupName}` : ""}
                  </span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  <code>{token.prefix}…</code>
                  {" · "}
                  {t("created", { date: dates.at(token.createdAt) })}
                  {" · "}
                  {/*
                   * The line that makes a forgotten key visible. "Never used"
                   * is the most useful thing this row can say — on a key minted
                   * a month ago it means whatever it was pasted into never
                   * worked at all, which is not something anybody would
                   * otherwise find out.
                   */}
                  {token.lastUsedAt
                    ? t("lastUsed", { date: dates.at(token.lastUsedAt) })
                    : t("neverUsed")}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setRevoking(token)}
                aria-label={t("revokeLabel", { name: token.name })}
                className="tap-target flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-wash-3 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2.5 border-t border-border px-4 py-3.5">
        {/* `Input` already carries `text-base md:text-sm`; overriding the size
            here is what `text-entry-size.test.ts` exists to catch. */}
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t("namePlaceholder")}
          aria-label={t("nameLabel")}
          maxLength={60}
        />

        <div className="flex gap-2">
          <Select
            value={scope}
            onValueChange={(value) => setScope(value as TokenScope)}
          >
            <SelectTrigger
              className="h-11 flex-1 md:h-8"
              aria-label={t("scopeLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="read">{t("scopeRead")}</SelectItem>
              <SelectItem value="write">{t("scopeWrite")}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger
              className="h-11 flex-1 md:h-8"
              aria-label={t("groupLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allGroups")}</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          onClick={onCreate}
          disabled={pending || name.trim().length === 0}
          className="h-10 w-full rounded-xl text-sm"
        >
          {pending ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : (
            <Plus aria-hidden="true" />
          )}
          {t("create")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("cardHint")}</p>
      </div>

      <Sheet
        open={minted !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMinted(null);
            setCopied(false);
          }
        }}
      >
        {/* No padding on the content itself: the room above the grabber is
            `ui/sheet.tsx`'s and a top padding here would push the pill down.
            The header and footer bring their own. */}
        <SheetContent side="bottom" className="gap-3.5">
          <SheetHeader className="gap-1.5 pb-0">
            <SheetTitle className="text-base font-semibold">
              {t("mintedTitle")}
            </SheetTitle>
            <SheetDescription className="text-pretty">
              {t("mintedOnce")}
            </SheetDescription>
          </SheetHeader>
          {/* Selectable, wrapping and in a monospace face, so the value can be
              read off the screen by somebody whose browser will not give a
              script the clipboard. */}
          <code className="mx-4 block rounded-lg bg-wash-3 px-3 py-2.5 text-xs break-all">
            {minted}
          </code>
          <SheetFooter className="pt-0">
            <Button
              onClick={() => void onCopy()}
              className="h-11 rounded-[14px] text-sm font-semibold"
            >
              {copied ? (
                <Check aria-hidden="true" />
              ) : (
                <Copy aria-hidden="true" />
              )}
              {copied ? t("copied") : t("copy")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmSheet
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t("revokeTitle")}
        body={t("revokeBody")}
        confirmLabel={t("revokeConfirm")}
        destructive
        onConfirm={() => revoking && onRevoke(revoking)}
      />
    </section>
  );
}
