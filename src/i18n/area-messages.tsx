import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { clientMessages, type MessageArea } from "./client-messages";

/**
 * The messages one part of the app adds to what every page carries.
 *
 * Mounted where that part begins — a layout, or the one page that is the
 * whole of it — and wrapped around everything that file renders, because the
 * rule test counts every Client Component the file imports as rendered inside
 * it. The lists, and why they are split at all, are in `client-messages.ts`.
 *
 * Locale, time zone and formats are inherited: next-intl's server provider
 * reads them from the request just as the root one does. Only the messages
 * differ, and they replace the root's rather than adding to them — which is
 * why `clientMessages` hands back the root's list with the area's on top.
 */
export async function AreaMessages({
  area,
  children,
}: {
  area: MessageArea;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      messages={clientMessages(await getMessages(), area)}
    >
      {children}
    </NextIntlClientProvider>
  );
}
