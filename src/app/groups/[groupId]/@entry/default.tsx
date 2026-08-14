/**
 * Nothing, which is what the slot holds on every other group route.
 *
 * Without this, a hard load of any group page would fail to match the slot and
 * take the whole route down with it.
 */
export default function NoEntryDrawer() {
  return null;
}
