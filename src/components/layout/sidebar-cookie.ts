import "server-only";
import { cookies } from "next/headers";
import { isSidebarCollapsed, SIDEBAR_COOKIE_NAME } from "./sidebar-state";

/** Whether this device asked for the folded sidebar; see `sidebar-state.ts`. */
export async function readSidebarCollapsed(): Promise<boolean> {
  const cookieStore = await cookies();
  return isSidebarCollapsed(cookieStore.get(SIDEBAR_COOKIE_NAME)?.value);
}
