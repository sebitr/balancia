import type { Metadata } from "next";
import Link from "next/link";
import { LinkSlash } from "@/components/icons/link-slash";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";

export const metadata: Metadata = { title: "Invitation link" };

const REASONS: Record<string, { title: string; body: string }> = {
  invalid: {
    title: "This invitation link no longer works",
    body: "It may have been revoked, replaced with a new link, or it may have expired. Ask whoever invited you to send a fresh one.",
  },
  "rate-limited": {
    title: "Too many attempts",
    body: "This instance limits how often invitation links can be opened from the same address. Wait a few minutes and try again.",
  },
  unavailable: {
    title: "Something went wrong",
    body: "The invitation could not be checked right now. Please try again in a moment.",
  },
};

export default async function JoinErrorPage({
  searchParams,
}: PageProps<"/join/error">) {
  const params = await searchParams;
  const reasonParam = params.reason;
  const reason = typeof reasonParam === "string" ? reasonParam : "invalid";
  const content = REASONS[reason] ?? REASONS.invalid;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto w-full max-w-5xl px-4 py-4">
          <Wordmark />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="max-w-md space-y-4 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <LinkSlash className="size-6" />
          </span>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {content.title}
          </h1>
          <p className="text-pretty text-muted-foreground">{content.body}</p>
          <div className="flex justify-center gap-3 pt-2">
            <Button asChild variant="outline">
              <Link href="/">Go to the home page</Link>
            </Button>
            <Button asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
