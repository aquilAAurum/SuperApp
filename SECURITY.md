# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue. Report privately through GitHub's "Report a vulnerability" (Security → Advisories) on this repository. Include steps to reproduce, the shell version (Settings → About) and the affected subapp id if any.

We acknowledge reports within 3 business days and aim to fix Critical/High issues within 30 days.

## Supported versions

| Version | Supported |
| :--- | :--- |
| latest release (shell APK, server bundle, SDK) | ✅ |
| older releases | ❌ (upgrade to latest) |

## Scope

The trust boundary is the subapp iframe: everything inside a subapp is untrusted; the shell and the server check everything. See [`THREAT_MODEL.md`](THREAT_MODEL.md).

Security owner: Mara (Security Engineer). Release owner: Theo (Release & SRE).
