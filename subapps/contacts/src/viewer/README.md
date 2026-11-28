# Vendored graph viewer

`graph-viewer.js` and `graph-viewer.css` are copies of `src/viewer/` in
[`aquilAAurum/Supra---Contacts`](https://github.com/aquilAAurum/Supra---Contacts), which is their
source of truth (same arrangement as `server/pb_migrations/1764201600_contacts.js`). Change them
there first, then copy them here unchanged; `src/viewer.test.ts` pins the copy's SHA-256 so a
local edit fails the unit tests.
