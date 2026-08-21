/**
 * The letter that stands in for a face.
 *
 * One line, and in a module of its own because both sides of the tree need it.
 * It used to live in `pills.tsx`, which is a client module — so a Server
 * Component that called it got "Attempted to call initialOf() from the server",
 * and the invite screen worked around that by writing the same
 * `charAt(0).toUpperCase()` again with a comment explaining why. Two copies of
 * one rule is how the guest list and the group list end up disagreeing about
 * what an accented name starts with.
 *
 * Trimmed first: a display name pasted with a leading space would otherwise
 * put a blank in the circle.
 */
export function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase();
}
