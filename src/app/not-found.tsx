import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto w-full max-w-5xl px-4 py-4">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Not found
          </h1>
          <p className="text-pretty text-muted-foreground">
            This page does not exist, or you do not have access to it.
          </p>
          <Button asChild>
            <Link href="/dashboard">Go to your groups</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
