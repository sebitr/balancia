import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/brand/wordmark";

export default async function NotFound() {
  const t = await getTranslations("notFound");

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
            {t("title")}
          </h1>
          <p className="text-pretty text-muted-foreground">{t("body")}</p>
          <Button asChild>
            <Link href="/dashboard">{t("goToGroups")}</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}
