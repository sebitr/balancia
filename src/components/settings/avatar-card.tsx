"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { initialOf } from "@/components/entries/initials";
import { AccountAvatar } from "./account-avatar";
import { squareToWebp, ImageDecodeError } from "./square-image";

/**
 * The photo on the account.
 *
 * The picture is squared and re-encoded here, in the browser, before it is
 * sent. Three things come of that and only one of them is bandwidth: a
 * canvas re-encode drops the EXIF block, so an avatar cannot carry the GPS
 * coordinates of the room it was taken in out to a URL; the file that arrives
 * is always one format at one size, so the server has one thing to validate;
 * and a 12 megapixel photograph from a phone camera does not have to cross a
 * mobile connection to be shown at 52 pixels.
 *
 * None of it is trusted. The route sniffs the type and enforces the size
 * again, because a POST written by hand never runs any of this.
 *
 * There is no Undo here. A replaced photo is gone — the object it named is
 * swept as soon as the new one lands — so the toast says what happened and
 * stops, which is the honest answer where a way back does not exist.
 */
export function AvatarCard({
  name,
  photoVersion,
}: {
  name: string;
  photoVersion: Date | null;
}) {
  const router = useRouter();
  const t = useTranslations("userSettings");
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", await squareToWebp(file), "avatar.webp");

      const response = await fetch("/api/profile/avatar", {
        method: "POST",
        body,
      });
      if (!response.ok) {
        const { error } = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        toast.error(error ?? t("photoFailed"));
        return;
      }
      toast.success(t("photoSaved"));
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof ImageDecodeError
          ? t("photoUnreadable")
          : t("photoFailed"),
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });
      if (!response.ok) {
        toast.error(t("photoFailed"));
        return;
      }
      toast.success(t("photoRemoved"));
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex shrink-0 items-center gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10">
      <AccountAvatar
        initial={initialOf(name)}
        version={photoVersion}
        className="size-13"
        letterClassName="text-lg"
        alt={t("photoAlt")}
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-base font-semibold">{name}</p>
        <div className="flex flex-wrap gap-2">
          <Pill
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            busy={busy}
          >
            {photoVersion ? t("photoChange") : t("photoAdd")}
          </Pill>
          {photoVersion && (
            <Pill disabled={busy} onClick={() => void remove()}>
              {t("photoRemove")}
            </Pill>
          )}
        </div>
      </div>

      {/* Off-screen rather than hidden: `display:none` on a file input makes
          it unreachable by keyboard, and the pill above is what should be
          reached anyway. `accept` filters the picker; the type is decided
          from the bytes, not from this. */}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so choosing the same file twice still fires a change.
          event.target.value = "";
          if (file) void upload(file);
        }}
      />
    </section>
  );
}

/** The small outlined button the design uses for a card's secondary action. */
function Pill({
  children,
  busy,
  ...props
}: React.ComponentProps<"button"> & { busy?: boolean }) {
  return (
    <button
      type="button"
      className="tap-target inline-flex h-7 items-center gap-1.5 rounded-full border border-input px-2.5 text-xs font-medium transition-colors hover:bg-wash-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
      {...props}
    >
      {busy && <Loader2 aria-hidden="true" className="size-3 animate-spin" />}
      {children}
    </button>
  );
}
