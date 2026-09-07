# Studio555 fork of Kaneo

This is Studio555's fork of [Kaneo](https://github.com/usekaneo/kaneo), self-hosted at
<https://kaneo.studio555.cloud>. `README.md` is upstream's; this file covers only what differs here.

It is a fork at the git level, not a GitHub fork: the repository is internal and carries upstream's
full history with `usekaneo/kaneo` configured as the `upstream` remote.

## Taking a new upstream release

```bash
git fetch upstream
git merge upstream/main        # or: git merge v2.24.0
```

Upstream's CI (`.github/workflows/`) and Dependabot config (`.github/dependabot.yml`) are
deliberately absent: the workflows published images to `ghcr.io/usekaneo`, ran semantic-release and
automated upstream's issue tracker, and Dependabot would open weekly dependency pull requests
against this fork. A merge that reintroduces those files should drop them again.

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
