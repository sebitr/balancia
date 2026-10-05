# Somebody opening a group's link picks their name, chooses how to join, and is in the group — invited, and spoken to as "you"

Branch: `feat/shorter-guest-join`

A group's shared link took six screens and six taps to reach the group as a
guest: a welcome, the list, "Is this you?", "how should we keep it?", "You're
in", and a setup checklist behind a button labelled "See the group". It now
opens on the list, under the group and an invitation ("Léa invited you to Flat
share. Which of these is you?"), then asks how to join, then lands in the
group with a "You're in" toast. Rows read "owes €60.00 · 2 expenses"; the next
screen says "You owe €60.00" with a way back to the list. The guest card on
the overview is what is left of the checklist, and only somebody owed money is
told an account lets them say how to be paid.

No Claude Design mock-up: the Artifact tool was refused in the session that
did this. The pattern page is `design-system/src/pages/patterns/join.html`.
