# Board Advisory Memos: Sprint 1 (Doc ID D17)

> Prepared by Claude acting as the three board personas. Advisory only; Nick decides.

---

To: Nick (CEO)
From: Vinod (Chairman of the Advisory Board)
Subject: Three milestones in one sprint — is the factory proving itself?

### Observation
Sprint 1 planned M1–M2 and delivered M1–M3 in automated form, with every required CI job green at `bfdb2a2`. Bassoon ADR-001's success measure asks for "a second app from PRD to a signed release in one sprint, zero Critical/High at MRB, no Core persona edits". We have the app and zero Critical/High findings, but no signed release and an MRB FAIL on missing evidence (D11).

### Questions / Guidance
- Is closing M1–M3 to a **signed, tagged v0.1.0** more valuable now than starting M4? A real release would complete the factory's success measure.
- Which two manual checks (D10 M-1, M-2) can you run this week on your phone?

### Metric or principle at stake
Profile KPI 1 (handshake < 500 ms on the phone) and KPI 2 (zero lost writes): both are proven only in the browser so far.

---

To: Nick (CEO)
From: Bob (Strategic Advisor, Architecture & Scale)
Subject: The bottleneck is now evidence on real hardware, not code

### Observation
The architecture held up: contracts-first, one door (bridge router), server-as-truth with idempotent ops. CI caught two server defects that local tests could not (reserved field name, superuser visibility). The current bottleneck is that the phone, the mini PC and the release pipeline have never run together.

### Questions / Guidance
- Should the next sprint begin with an "end-to-end on real hardware" slice (mini PC with Tailscale Serve, sideloaded APK, M-1/M-2/M-3) before M4 adds device permissions?
- `shell.ts` is becoming the place where everything is wired (D08 J-5). Do we split it before M4, while it is still cheap?

### Metric or principle at stake
Spec principle "The server is truth"; Core CORE-01 (evidence over attestation).

---

To: Nick (CEO)
From: Eleanor (Product & User Advocate)
Subject: Does it feel like "one door, no surprises"?

### Observation
The magic moment (icon to any subapp in under 2 s, signed in) depends on silent sign-in, which works on Android but not in the browser build (token kept in memory by design). The sync header turns into a button that leads straight to the fix: a good expression of "no surprises".

### Questions / Guidance
- Is `Pending (n)` in warning colour too alarming when you are briefly offline (Anansi's open question in D03)?
- Conflict cards show raw JSON. For your own apps that is fine; would you want a friendlier diff before you migrate your first real app?

### Metric or principle at stake
Brand promise "One door, no surprises"; magic moment in Profile §1.
