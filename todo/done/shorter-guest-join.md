# Somebody opening a group's link picks their name, chooses how to join, and is in the group — invited, and spoken to as "you"

Merged: 2026-10-05 in #428

A group's shared link took six screens and six taps to reach the group as a
guest: a welcome, the list, "Is this you?", "how should we keep it?", "You're
in", and a setup checklist behind a button labelled "See the group". It now
opens on the list, under the group and an invitation ("Léa invited you to Flat
share. Which of these is you?"), then asks how to join, then lands in the
group with a "You're in" toast. Rows read "owes €60.00 · 2 expenses"; the next
screen says "You owe €60.00" with a way back to the list. The guest card on
the overview is what is left of the checklist, and only somebody owed money is
told an account lets them say how to be paid.

A personal invitation's guest ends the same way: their name, then the group.
An account still gets "You're in" and the checklist, behind buttons that say
what they do — "Finish setting up" and "Go to the group".

Claude Design mock-up, before and after:
https://claude.ai/artifact/SgmB3s2EfHyxNViKxWrWDk. The pattern page is
`design-system/src/pages/patterns/join.html`.
