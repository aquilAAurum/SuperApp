---
id: ADR-002
title: Svelte 5 for the shell UI
status: Accepted
date: 2026-11-21
decided_by: nick
supersedes: []
---

# ADR-002: Svelte 5 for the shell UI

## 1. Context

Spec open question 1: React or Svelte for the shell UI. The shell runs in an Android WebView today and in a Google TV WebView later, owns seven small screens, and must keep its logic in framework-free TypeScript so it can be shared by future shells.

## 2. Decision

Use **Svelte 5** (runes) with Vite for the shell's screens. All logic (bridge router, handshake, lifecycle, permissions, server client, broker) stays in plain TypeScript modules under `apps/shell/src/{bridge,host,core,server,native}` with no Svelte imports; components only render state and call those modules.

## 3. Rationale

| Factor | Svelte 5 | React |
| :-- | :-- | :-- |
| Runtime size in a TV-class WebView | Compiled, small runtime | Larger runtime + reconciler |
| Store contract | Any `{ subscribe }` object is a store, so plain-TS modules (`RingLog`, `writable`) bind without adapters | Needs hooks/adapters per store |
| Type checking | `svelte-check --fail-on-warnings` in CI | `tsc` |
| Ecosystem for vibe-coded subapps | Irrelevant: subapps choose their own framework and depend only on `@superapp/sdk` | Same |

## 4. Consequences

- Subapps are unaffected; the SDK is framework-free.
- Reversing this decision rewrites five components, not the shell logic.
