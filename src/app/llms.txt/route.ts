import { getEnv } from "@/lib/env";
import { llmsIndex } from "@/components/marketing/llms";

export const dynamic = "force-dynamic";

/** Balancia as a list of facts, for a language model. See `components/marketing/llms.ts`. */
export function GET(): Response {
  return new Response(llmsIndex(getEnv().appOrigin), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Read by crawlers on their own schedule; an hour is as fresh as any
      // of them needs and spares the render for the rest.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
