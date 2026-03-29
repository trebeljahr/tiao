# Investigation: No Git LFS

**Status:** Decided
**Date:** 2026-03-29

## Context

Binary assets (images, audio) were tracked with Git LFS to keep the repository size small. However, the Docker build on Coolify clones the repo and runs `docker build` — and the build context sent to Docker does not include `.git/` (excluded via `.dockerignore`). This means `COPY` instructions copy the LFS pointer files (tiny text stubs) instead of the actual binary content, resulting in broken images and audio in production.

## Options Considered

### Keep LFS, configure Coolify pre-build command

- Add `git lfs install && git lfs pull` as a Coolify pre-build command so the working directory has real files before Docker receives the build context.
- Couples the build to Coolify-specific configuration that isn't version-controlled.
- Easy to forget when migrating to a different CI/CD platform or setting up a new environment.
- Fragile: any CI system that doesn't smudge LFS before `docker build` will silently ship pointer files.

### Keep LFS, copy `.git/` into Docker build

- Remove `.git` from `.dockerignore`, install `git-lfs` in the build stage, and run `git lfs pull` inside the Dockerfile.
- Massively bloats the Docker build context (entire git history sent on every build).
- Slows down builds for no real benefit.

### Remove Git LFS entirely (chosen)

- Store all binary assets as regular git objects.
- Total asset size is ~400 KB across 15 files — negligible impact on repository size.
- Docker `COPY` works everywhere with no special tooling.

## Decision

Remove Git LFS. The repository has fewer than 20 binary assets totalling well under 1 MB. Git LFS was designed for repositories with large binary files (game assets, datasets, videos) where cloning the full history would be prohibitively expensive. For a handful of small images and one sound file, plain git is simpler, more portable, and eliminates an entire class of deployment bugs.

## Caveats

- Repository clones will include all versions of these binary files in history. At current scale this is negligible, but if the project ever accumulates hundreds of megabytes of assets, LFS (or an external CDN) should be reconsidered.
- Any new CI/CD pipeline or Docker-based deployment will just work without needing to know about LFS.
- Contributors do not need `git-lfs` installed.
