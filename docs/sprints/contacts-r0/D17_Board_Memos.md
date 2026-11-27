# Board Advisory Memos: Contacts R0 (Doc ID D17)

> Prepared by Claude acting as the board personas. Advisory only; Nick decides.

---

To: Nick (CEO)
From: Bob (Strategic Advisor, Architecture & Scale)
Subject: Client-side graph or a server route? (PRD §4.2, NFR-1)

### Observation
The network queries already exist as SQL views (`v_backlinks`, `v_org_people`, `v_shared_context`, `contacts_reach_out`) and the graph viewer runs client-side. Measured in Supra---Contacts: the viewer holds 60 fps at 1,380 nodes / 3,910 links (canvas, Barnes–Hut), and the real vault is about 1,000 nodes today, ~70 % of them unresolved names. Paths and overlaps are 1–3 hops.

### Questions / Guidance
- Keep graph queries **client-side over the phone mirror** for v1; the volume assumption (≤ 5,000 contacts, ≤ 20,000 links) is 4–5× today's vault.
- Add a server route only if R4's benchmark on the phone misses: warm-intro paths < 300 ms p95, Who-I-know < 100 ms.
- The SQLite views are the portable part: the same SQL runs in PocketBase and in the phone's SQLCipher mirror, so moving a query server-side later is cheap.

### Metric or principle at stake
NFR-1/NFR-2 (scale and search speed); "server is truth" (SA-C5) without making the phone depend on the network for reads.

---

To: Nick (CEO)
From: Eleanor (Product & User Advocate)
Subject: Launcher-first, the lens, and honest touch logging

### Observation
The design (D03) puts the identity in the primary button ("Teams chat · USCD") and defaults the guard sheet to the safe account. Spikes S1–S4 will show that some email identities cannot be forced (Outlook holds two accounts; Gmail has no documented account extra). The lens (All · Work · Professional · Personal) plus contexts is a two-level model that is easy to get lost in.

### Questions / Guidance
- **K5 risk:** "dismiss = Attempted" inflates touch capture. Prefer: dismiss logs nothing, the person stays due, and a small "Log it?" chip stays on the row until tomorrow.
- **Lens model:** show the context as a chip on every row and card ("Work › USCD"); make the lens a filter you can see, not a mode you forget you're in.
- **Where the account can't be forced:** say so before launch ("Outlook will open with the last account used; switch to Milford if needed") instead of after.
- One week of real use on the phone after R3 (hallway test) before campaigns.

### Metric or principle at stake
K3 (zero wrong-identity sends) and K5 (≥ 80 % touch capture, measured honestly); brand promise "no surprises".
