# Investigation: Analytics Platform

**Status:** Pending
**Date:** 2026-03-28

## Context

The game has no user-facing analytics or event tracking. Understanding player behavior (retention, feature usage, funnel drop-off) requires an analytics platform. Privacy-respecting, self-hostable solutions are preferred given the project's self-hosted infrastructure (Coolify on Hetzner VPS).

## Options Considered

### OpenPanel

- Open-source, self-hostable analytics
- Privacy-focused, GDPR-friendly
- Modern dashboard with event tracking, funnels, and retention
- Can run alongside existing Coolify infrastructure
- Smaller community than Plausible

### Plausible Analytics

- Open-source, self-hostable (or hosted at plausible.io)
- Lightweight script (~1KB), no cookies, GDPR-compliant by default
- Focused on page-level analytics (pageviews, referrers, geography)
- Limited custom event support compared to full product analytics tools
- Well-established, large community, active development
- Self-hosting requires PostgreSQL + ClickHouse — heavier infrastructure

### PostHog

- Open-source product analytics with feature flags, session replay, A/B testing
- Very feature-rich but heavyweight for a game project
- Self-hosting is resource-intensive (Kafka, ClickHouse, PostgreSQL, Redis)
- Overkill for current needs

### Google Analytics

- Free, comprehensive, industry standard
- Privacy concerns — data sent to Google, cookie banners required
- Against the project's self-hosted philosophy

## Current Leaning

OpenPanel is listed in the project roadmap as the intended choice. No implementation has been done yet. The key decision factors are:

- Self-hostable on existing Hetzner VPS via Coolify
- Custom event tracking (not just pageviews) for game-specific metrics
- Lightweight infrastructure requirements
- Privacy-respecting defaults

## Open Questions

- What specific events matter most? (game starts, completions, rematch rate, feature adoption)
- Is Plausible's simpler page-level analytics sufficient, or do we need OpenPanel's deeper event tracking?
- Infrastructure budget — can the VPS handle an additional analytics service alongside MongoDB, Redis, and the app?
