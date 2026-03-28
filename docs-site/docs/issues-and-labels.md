---
sidebar_position: 5
title: Issues, Labels & Workflows
---

# Issues, Labels & Workflows

This page explains how we use GitHub Issues and labels to track work on Tiao. Whether you're reporting a bug, requesting a feature, or picking up something to work on, this is how the process works.

## Opening an Issue

When you [create a new issue](https://github.com/trebeljahr/tiao/issues/new/choose), you'll see a template chooser with three options:

| Template                      | Use when...                                       |
| ----------------------------- | ------------------------------------------------- |
| **Bug Report**                | Something isn't working correctly                 |
| **Feature Request**           | You have an idea for a new feature or improvement |
| **Documentation Improvement** | Docs are unclear, missing, or wrong               |

Each template is a structured form — fill in the fields and we'll have everything we need to act on it. Blank issues are disabled to keep things organized.

For **questions and discussions**, use [GitHub Discussions](https://github.com/trebeljahr/tiao/discussions) instead of issues. For **security vulnerabilities**, use [GitHub Security Advisories](https://github.com/trebeljahr/tiao/security/advisories/new) to report them privately.

## Labels

Every issue gets labels from four categories. Labels use a `category: value` format so they're easy to filter.

### Type — what kind of work

| Label               | Description                          |
| ------------------- | ------------------------------------ |
| `type: bug`         | Something isn't working              |
| `type: feature`     | New feature or request               |
| `type: enhancement` | Improvement to an existing feature   |
| `type: docs`        | Documentation change                 |
| `type: chore`       | Maintenance, refactoring, or tooling |

### Status — where it is in the pipeline

| Label                        | Description                                   |
| ---------------------------- | --------------------------------------------- |
| `status: triage`             | New issue, needs review by a maintainer       |
| `status: confirmed`          | Confirmed and ready for someone to pick up    |
| `status: needs info`         | We need more details from the reporter        |
| `status: needs reproduction` | We need a minimal reproduction to investigate |
| `status: blocked`            | Waiting on something else                     |
| `status: wontfix`            | Won't be addressed (with explanation)         |
| `status: duplicate`          | Duplicate of another issue                    |

### Priority — how urgent

| Label                | Description                                          |
| -------------------- | ---------------------------------------------------- |
| `priority: critical` | Must be fixed ASAP — game-breaking or security issue |
| `priority: high`     | Important, blocks progress on other work             |
| `priority: medium`   | Should be fixed soon                                 |
| `priority: low`      | Nice to have, no rush                                |

### Area — which part of the codebase

| Label               | Description                          |
| ------------------- | ------------------------------------ |
| `area: game-engine` | Game rules and engine (`shared/`)    |
| `area: server`      | Backend, API, WebSocket (`server/`)  |
| `area: client`      | Frontend, UI, components (`client/`) |
| `area: matchmaking` | Matchmaking and game pairing         |
| `area: social`      | Friends, invitations, profiles       |
| `area: ai`          | Computer opponent                    |
| `area: infra`       | CI/CD, Docker, deployment            |

### Community

| Label              | Description                                                   |
| ------------------ | ------------------------------------------------------------- |
| `good first issue` | Good for newcomers — scoped, well-defined, and approachable   |
| `help wanted`      | Extra attention needed — we'd especially appreciate help here |

## Issue Lifecycle

Here's the typical flow of an issue from creation to close:

```
Opened ──► status: triage ──► status: confirmed ──► Someone picks it up ──► PR merged ──► Closed
                │                                          │
                ├──► status: needs info ──► (reporter responds) ──► back to triage
                ├──► status: needs reproduction ──► (reporter provides) ──► back to triage
                ├──► status: wontfix ──► Closed
                └──► status: duplicate ──► Closed (linked to original)
```

1. **New issues** automatically get `status: triage` from the issue template.
2. A **maintainer reviews** the issue and either confirms it, asks for more info, or closes it.
3. Once `status: confirmed`, the issue gets **priority** and **area** labels.
4. Anyone can pick up a confirmed issue — just leave a comment saying you're working on it.
5. Open a PR that references the issue (e.g., "Closes #42"), and it'll close automatically when merged.

## Finding Something to Work On

Looking for something to contribute? Filter by:

- [`good first issue`](https://github.com/trebeljahr/tiao/labels/good%20first%20issue) — great starting points if you're new
- [`help wanted`](https://github.com/trebeljahr/tiao/labels/help%20wanted) — issues where we'd love community help
- [`status: confirmed`](https://github.com/trebeljahr/tiao/labels/status%3A%20confirmed) — all confirmed issues ready for work

## Pull Requests

When you open a PR, you'll see a template with three sections:

1. **Summary** — what the PR does and why (link the related issue with "Closes #N")
2. **How to test** — steps for the reviewer to verify your change
3. **Screenshots** — for UI changes, include before/after screenshots

Keep PRs focused on a single issue or feature. If your change touches multiple areas, consider splitting it into separate PRs.

See the [Contributing guide](contributing) for the full development workflow including our rebase-only git process.
