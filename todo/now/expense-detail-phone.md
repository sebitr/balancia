# The expense detail reads right on a phone: a plain total, your part in words, and a split that is not cut off

Branch: `fix/expense-detail-phone`

Design: https://claude.ai/artifact/6F1VPeq12jBg9uxj3tJvH8

The "Split between" table needed 370px in a 343px card and clipped its balance
column ("BALANC", "+ €60.0"); the total was a red "− EUR 90.00" for every
reader, the person who was owed included. Audit items EXP-2 and EXP-3.
