import "server-only";
import { cookies } from "next/headers";
import { isNarrowWindow, NARROW_COOKIE_NAME } from "./narrow-window";

/**
 * Whether this device's window was last below `lg`, so the desk-only reads
 * can be left out; see `narrow-window.ts`.
 */
export async function readNarrowWindow(): Promise<boolean> {
  const cookieStore = await cookies();
  return isNarrowWindow(cookieStore.get(NARROW_COOKIE_NAME)?.value);
}
