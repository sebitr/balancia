import { GoneEntry } from "@/components/entries/gone-entry";

/** This expense has gone — most likely because the reader has just moved it. */
export default function ExpenseNotFound() {
  return <GoneEntry />;
}
