# CI/CD Guide

## Overview

Brickt uses GitHub Actions for continuous integration and gated promotions.

Workflows:

1. `CI` (`.github/workflows/ci.yml`)
2. `Promote` (`.github/workflows/promote.yml`)

## CI Workflow

Triggers:

- Pull requests to `main`
- Pushes to `main`

Checks:

1. Backend test (`pnpm --filter @homeshare/backend test`)
2. Frontend build (`pnpm --filter @homeshare/frontend build`)
3. Contracts test (`pnpm --filter @homeshare/contracts test`)

## Promotion Workflow

Trigger:

- Manual `workflow_dispatch`

Inputs:

1. `target_environment`: `staging` or `production`
2. `git_ref`: branch/tag/SHA to promote

Stages:

1. Validate candidate (tests + builds)
2. Package artifacts (`backend/dist`, `frontend/dist`)
3. Deploy job bound to GitHub environment:
   - `brickt-staging`
   - `brickt-production`

## Required GitHub Environment Setup

Create GitHub environments:

1. `brickt-staging`
2. `brickt-production`

Recommended protection rules:

1. Required reviewers enabled (especially production).
2. Deployment branch/tag restrictions.
3. Environment secrets configured for deployment credentials.

## Branch Protection Recommendations

For `main`:

1. Require pull request reviews.
2. Require status checks to pass:
   - `Backend Test`
   - `Frontend Build`
   - `Contracts Test`
3. Disallow force-pushes.

## Deployment Step Wiring

`promote.yml` includes a placeholder deploy step. Replace with your actual deployment commands:

- backend deploy (PM2/container/Kubernetes)
- frontend asset upload (CDN/object storage/static host)
- optional post-deploy verification scripts
