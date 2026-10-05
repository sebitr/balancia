# Two people signing up at once on a new instance cannot both become its administrator

Branch: `fix/first-admin-race`

The first-account rule moves from a subquery in `insertUser`'s INSERT to a
trigger on `users` that takes an advisory lock. The same move covers Sign in
with Apple, which wrote its own row and never made anyone administrator.
