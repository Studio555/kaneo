# Studio555 fork of Kaneo

This is Studio555's fork of [Kaneo](https://github.com/usekaneo/kaneo), self-hosted at
<https://kaneo.studio555.cloud>. `README.md` is upstream's; this file covers only what differs here.

It is a GitHub fork of `usekaneo/kaneo`; add it as the `upstream` remote
(`git remote add upstream https://github.com/usekaneo/kaneo.git`).

## Taking a new upstream release

```bash
git fetch upstream
git merge upstream/main        # or: git merge v2.24.0
```

Upstream's CI (`.github/workflows/`) and Dependabot config (`.github/dependabot.yml`) are
deliberately absent: the workflows published images to `ghcr.io/usekaneo`, ran semantic-release and
automated upstream's issue tracker, and Dependabot would open weekly dependency pull requests
against this fork. A merge that reintroduces those files should drop them again.

Fork-only schema changes are separate Drizzle migrations (currently `0064_s555_fork_features`).
When an upstream merge brings migrations with clashing numbers, take upstream's journal entries
and snapshots, re-append ours after them with their original tag and `when`, and confirm
`pnpm --filter @kaneo/api db:generate` reports no changes. Drizzle applies only migrations newer
than the last one recorded, so an upstream migration whose `when` is older than our latest
deployed one would be skipped; check timestamps before deploying.

## Deploying

```bash
./deploy.sh live                  # build, push, and roll out to the kaneo-live stack
./deploy.sh --only-release live   # build and push only, no infrastructure changes
./deploy.sh --no-pull live        # skip the git pull first
```

`deploy.sh` builds `Dockerfile.kaneo` for `linux/amd64`, pushes it to
`europe-north1-docker.pkg.dev/s555-devservices-shared/docker/kaneo` tagged `latest` and the short
git SHA, then runs `pulumi up` on the `kaneo-<profile>` stack and commits the resulting image bump
in `s555-iac`. It refuses to run unless the `../s555-iac` checkout is clean and on an up-to-date
`main`, so commit your infrastructure changes first.

Requires Docker with buildx, `gcloud auth configure-docker europe-north1-docker.pkg.dev`, and
`gcloud auth application-default login` as a member of `developers@studio555.io`.

## Infrastructure

The service is defined in [`s555-iac`](https://github.com/Studio555/s555-iac), not here:
`KaneoStack.java` and `kaneo/KaneoWorkload.java`, configured by `Pulumi.kaneo-live.yaml`. It runs on
the shared GKE cluster in the `tools` namespace against Cloud SQL Postgres, with attachments in GCS
over the S3 interoperability API. Environment variables, secrets, scaling and DNS are all set there
— nothing environment-specific is configured in this repository.

## Agent fixes from Slack

Reacting to a Slack message with the integration's `agentEmoji` files the task (as the filing
emoji does), makes sure it has a GitHub issue, and labels that issue `agent:fix` with a request
comment. The `agent-fix` workflow in `Studio555/s555-atlas` does the fix and answers with a
result comment from `github-actions[bot]`; Kaneo turns that into Slack DMs to the person who
reacted, and to `maintainerSlackUserId` when Codex on the runner is signed out. The comment
markers are the contract between the two repositories: change them in both or neither.

Turn it on per project through the Slack app integration API, for example
`PATCH /api/slack-app-integration/project/<projectId>` with
`{"agentEmoji": "robot_fix", "maintainerSlackUserId": "U…"}`. The DMs land in the app's
Messages tab, which must be enabled under App Home in the Slack app settings.
