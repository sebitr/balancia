"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The recovery key, drawn so that it can be read aloud and checked.
 *
 * An age identity is `AGE-SECRET-KEY-1` and 58 more characters. Set as one
 * line it is a wall nobody can compare against what they wrote down, so it is
 * the prefix on a line of its own, then groups of four, and a last group of
 * six in an outline: that outline is what "type the last 6 characters" points
 * at, and it is a shape rather than a colour, so it works for everybody.
 *
 * The groups are computed from the key and not set by hand, because the key is
 * a different string every time.
 */

const PREFIX = "AGE-SECRET-KEY-1";
const GROUP = 4;
export const CONFIRM_LENGTH = 6;

export function splitIdentity(identity: string): {
  prefix: string;
  groups: string[];
  tail: string;
} {
  const hasPrefix = identity.toUpperCase().startsWith(PREFIX);
  const prefix = hasPrefix ? identity.slice(0, PREFIX.length) : "";
  const body = hasPrefix ? identity.slice(PREFIX.length) : identity;
  const tail = body.slice(-CONFIRM_LENGTH);
  const rest = body.slice(0, body.length - tail.length);
  const groups: string[] = [];
  for (let at = 0; at < rest.length; at += GROUP) {
    groups.push(rest.slice(at, at + GROUP));
  }
  return { prefix, groups, tail };
}

/** `age-keygen`'s own layout, so `age -d -i` opens the file as it is. */
export function keyFileText(identity: string, recipient: string): string {
  const created = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return `# created: ${created}\n# public key: ${recipient}\n${identity}\n`;
}

export const KEY_FILE_NAME = "balancia-recovery-key.txt";

export function RecoveryKeyBlock({
  identity,
  recipient,
  label,
}: {
  identity: string;
  recipient: string;
  /** What the block is called above it; "Your recovery key" unless told. */
  label?: string;
}) {
  const t = useTranslations("cloudBackup");
  const labelId = useId();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const block = useRef<HTMLDivElement>(null);
  const { prefix, groups, tail } = splitIdentity(identity);

  useEffect(() => () => clearTimeout(timer.current), []);

  /** Where the clipboard is out of reach, leave the key selected for Ctrl+C. */
  const selectKey = () => {
    const node = block.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(identity);
    } catch {
      // No clipboard on an address that is not secure, or a refusal. The key
      // is still on screen and now selected, which is the next best thing.
      selectKey();
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([keyFileText(identity, recipient)], { type: "text/plain" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = KEY_FILE_NAME;
    document.body.append(link);
    link.click();
    link.remove();
    // The download has been asked for by now; the address is not needed again.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="space-y-2.5">
      <p id={labelId} className="text-xs font-semibold">
        {label ?? t("key.label")}
      </p>
      <div
        ref={block}
        role="group"
        aria-labelledby={labelId}
        className="rounded-xl bg-wash-2 p-3.5 font-mono text-sm leading-relaxed ring-1 ring-foreground/10"
      >
        {prefix && <div className="break-all">{prefix}</div>}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1.5">
          {groups.map((group, index) => (
            <span key={index}>{group} </span>
          ))}
          <span className="rounded-md px-1.5 font-semibold ring-2 ring-foreground">
            {tail}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={copy}
          className="flex-1 sm:flex-none"
        >
          {copied ? (
            <Check aria-hidden="true" className="size-4" />
          ) : (
            <Copy aria-hidden="true" className="size-4" />
          )}
          {copied ? t("key.copied") : t("key.copy")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={download}
          className="flex-1 sm:flex-none"
        >
          <Download aria-hidden="true" className="size-4" />
          {t("key.download")}
        </Button>
      </div>
      {/* The button changes its own label, which a screen reader does not
          announce; this says it for the ones who are not looking. */}
      <p aria-live="polite" className="sr-only">
        {copied ? t("key.copied") : ""}
      </p>
    </div>
  );
}
