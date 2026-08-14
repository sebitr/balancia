import { redirect } from "next/navigation";

/**
 * Creating a group stopped being a screen.
 *
 * It is a sheet over the group list now, opened by `?new`. This route stays
 * because it is still addressed from outside the app — the PWA shortcut in
 * the manifest, and whatever anyone has bookmarked — and sending those to the
 * list with the sheet already open is exactly where they were going.
 */
export default function NewGroupPage() {
  redirect("/dashboard?new");
}
