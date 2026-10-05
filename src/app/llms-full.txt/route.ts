import { getEnv } from "@/lib/env";
import { llmsFull } from "@/components/marketing/llms";

export const dynamic = "force-dynamic";

/**
 * `/llms.txt` with the comparisons and the questions written out — every
 * public page's words in one file, for a crawler that would rather not parse
 * a layout to find them. See `components/marketing/llms.ts`.
 */
export async function GET(): Promise<Response> {
  return new Response(await llmsFull(getEnv().appOrigin), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
