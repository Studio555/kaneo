#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e
# Ensure pipeline failures are detected
set -o pipefail

# --- Configuration (You can adjust these if needed) ---
REGISTRY="europe-north1-docker.pkg.dev"
IMAGE_GROUP="s555-devservices-shared/docker"
IMAGE_NAME="kaneo"
# The all-in-one image (API + nginx-served web) that the GKE workload runs
DOCKERFILE="Dockerfile.kaneo"
# The shared cluster runs amd64 nodes, so build for it explicitly rather than for the host
PLATFORM="linux/amd64"
# Pulumi project directory
PULUMI_DIR="../s555-iac"
# --- End Configuration ---

# --- Default values ---
PULL_GIT=true
PROFILES=()
ONLY_RELEASE=false

# --- Argument Handling ---

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-pull)
      PULL_GIT=false
      shift
      ;;
    --only-release)
      ONLY_RELEASE=true
      shift
      ;;
    -*)
      echo "Unknown option: $1"
      echo "Usage: $0 [--no-pull] [--only-release] <profile_name> [profile_name2] [profile_name3] ..."
      echo "Example: $0 live"
      echo "Example: $0 --no-pull live"
      echo "Example: $0 --only-release live"
      echo "At least one profile name is required."
      echo "--only-release: Only build and release Docker image, skip GKE deployment"
      exit 1
      ;;
    *)
      PROFILES+=("$1")
      shift
      ;;
  esac
done

# Validate that at least one profile was provided
if [ ${#PROFILES[@]} -eq 0 ]; then
  echo "------------------------------------------------------------"
  echo "Error: At least one profile name is required!"
  echo "       Please provide one or more profile names as arguments."
  echo "       Usage: $0 [--no-pull] [--only-release] <profile_name> [profile_name2] ..."
  echo "       Example: $0 live"
  echo "------------------------------------------------------------"
  exit 1
fi

# Check for forbidden profiles and validate all profiles exist
echo "--- Validating profiles: ${PROFILES[*]} ---"
for PROFILE in "${PROFILES[@]}"; do
  if [ "$PROFILE" = "dev" ] || [ "$PROFILE" = "test" ]; then
    echo "------------------------------------------------------------"
    echo "Error: Profile '$PROFILE' is not allowed!"
    echo "       The dev and test profiles cannot be deployed."
    echo "------------------------------------------------------------"
    exit 1
  fi

  # Kaneo keeps no per-environment files of its own: every environment value lives in the
  # stack config, so the stack file is what has to exist. A release-only build never reaches
  # a stack, and must not require the s555-iac checkout to be present.
  if [ "$ONLY_RELEASE" = false ]; then
    STACK_FILE="${PULUMI_DIR}/Pulumi.${IMAGE_NAME}-${PROFILE}.yaml"
    if [ ! -f "${STACK_FILE}" ]; then
      echo "------------------------------------------------------------"
      echo "Error: Stack configuration for profile '${PROFILE}' not found!"
      echo "       Expected location: '${STACK_FILE}'"
      echo "       A new stack must be created by a human with the KMS secrets provider:"
      echo "       pulumi stack init ${IMAGE_NAME}-${PROFILE} --secrets-provider \"gcpkms://projects/s555-infrastructure-shared/locations/global/keyRings/s555-iac-pulumi-secrets/cryptoKeys/s555-iac-pulumi-stack-key\""
      echo "------------------------------------------------------------"
      echo "Deployment aborted."
      exit 1
    fi
    echo "Stack file found for profile '${PROFILE}': ${STACK_FILE}"
  fi
done

if [ "$ONLY_RELEASE" = true ]; then
  echo "--- Starting release-only build for profiles: ${PROFILES[*]} ---"
else
  echo "--- Starting GKE deployment for profiles: ${PROFILES[*]} ---"
fi

# --- Sanity Checks (before building) ---
echo "--- Performing sanity checks ---"

# The image is built with buildx so it can target the cluster's architecture from any host.
if ! docker buildx version >/dev/null 2>&1; then
  echo "------------------------------------------------------------"
  echo "Error: docker buildx is not available!"
  echo "       This script cross-builds a ${PLATFORM} image and needs it."
  echo "       Please install Docker with the buildx plugin."
  echo "------------------------------------------------------------"
  exit 1
fi
echo "docker buildx found."

# Pushing to Artifact Registry needs a credential helper for the registry host. The push would
# fail with an opaque authorization error, so say what to run instead of only warning late.
if ! grep -q "${REGISTRY}" "${HOME}/.docker/config.json" 2>/dev/null; then
  echo "------------------------------------------------------------"
  echo "Warning: no credential helper for ${REGISTRY} in ~/.docker/config.json"
  echo "         If the push fails with an authorization error, run:"
  echo "         gcloud auth configure-docker ${REGISTRY}"
  echo "------------------------------------------------------------"
fi

# Check if Pulumi directory exists (needed for deployment)
if [ "$ONLY_RELEASE" = false ]; then
  if [ ! -d "${PULUMI_DIR}" ]; then
    echo "------------------------------------------------------------"
    echo "Error: Pulumi project directory not found!"
    echo "       Expected location: '${PULUMI_DIR}'"
    echo "------------------------------------------------------------"
    echo "Deployment aborted."
    exit 1
  fi
  echo "Pulumi directory found: ${PULUMI_DIR}"

  # Check git status of s555-iac folder
  echo "Checking git status of ${PULUMI_DIR}..."

  # Change to Pulumi directory to check git status
  cd "${PULUMI_DIR}"

  # Check if it's a git repository
  if [ ! -d ".git" ]; then
    echo "------------------------------------------------------------"
    echo "Error: ${PULUMI_DIR} is not a git repository!"
    echo "       Please ensure the s555-iac directory is properly initialized as a git repository."
    echo "------------------------------------------------------------"
    echo "Deployment aborted."
    exit 1
  fi

  # Check if working directory is clean (no uncommitted changes)
  if ! git diff-index --quiet HEAD --; then
    echo "------------------------------------------------------------"
    echo "Error: ${PULUMI_DIR} has uncommitted changes!"
    echo "       Please commit or stash your changes before deploying."
    echo "       Uncommitted changes:"
    git status --porcelain
    echo "------------------------------------------------------------"
    echo "Deployment aborted."
    exit 1
  fi

  # Check if there are untracked files
  if [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo "------------------------------------------------------------"
    echo "Error: ${PULUMI_DIR} has untracked files!"
    echo "       Please add and commit or remove these files before deploying."
    echo "       Untracked files:"
    git ls-files --others --exclude-standard
    echo "------------------------------------------------------------"
    echo "Deployment aborted."
    exit 1
  fi

  # Check if we're on main branch and it's up to date
  CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "------------------------------------------------------------"
    echo "Warning: ${PULUMI_DIR} is not on main branch (currently on: ${CURRENT_BRANCH})"
    echo "         It's recommended to deploy from main branch."
    echo "------------------------------------------------------------"
  fi

  # Fetch latest changes to compare with remote
  echo "Fetching latest changes from remote..."
  git fetch origin main

  # If local is behind remote, try a fast-forward pull
  LOCAL_COMMIT=$(git rev-parse HEAD)
  REMOTE_COMMIT=$(git rev-parse origin/main)

  if [ "$LOCAL_COMMIT" != "$REMOTE_COMMIT" ]; then
    echo "${PULUMI_DIR} is not up to date with remote main. Attempting fast-forward pull..."
    if git pull --ff-only origin main; then
      echo "Successfully pulled latest changes."
    else
      echo "------------------------------------------------------------"
      echo "Error: Failed to fast-forward ${PULUMI_DIR} to remote main!"
      echo "       This likely means there are divergent changes that require manual resolution."
      echo "       Please resolve manually: cd ${PULUMI_DIR} && git pull origin main"
      echo "------------------------------------------------------------"
      echo "Deployment aborted."
      exit 1
    fi
  fi

  # Every stack must use the KMS secrets provider. A passphrase-encrypted stack here means this
  # checkout is stale or a stack was created without --secrets-provider; a pulumi up from it would
  # silently re-encrypt that stack back to the empty passphrase. See yaml_secrets_migration.md.
  if grep -l '^encryptionsalt:' Pulumi.*.yaml >/dev/null 2>&1; then
    echo "------------------------------------------------------------"
    echo "Error: ${PULUMI_DIR} has passphrase-encrypted stack config:"
    grep -l '^encryptionsalt:' Pulumi.*.yaml
    echo "       Every stack must use the KMS secrets provider. Fix with:"
    echo "       pulumi stack change-secrets-provider -s <stack> \"gcpkms://projects/s555-infrastructure-shared/locations/global/keyRings/s555-iac-pulumi-secrets/cryptoKeys/s555-iac-pulumi-stack-key\""
    echo "------------------------------------------------------------"
    echo "Deployment aborted."
    exit 1
  fi

  echo "Git status check passed for ${PULUMI_DIR}"

  # Return to original directory
  cd - > /dev/null
fi

# Every stack encrypts its secrets with the shared KMS key; PULUMI_CONFIG_PASSPHRASE is no longer used.
# Decrypting needs Application Default Credentials for an identity in developers@studio555.io.
if [ "$ONLY_RELEASE" = false ]; then
  if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
    echo "------------------------------------------------------------"
    echo "Error: No Application Default Credentials for GCP!"
    echo "       Pulumi decrypts stack secrets with the shared KMS key and needs them."
    echo "       Please run: gcloud auth application-default login"
    echo "------------------------------------------------------------"
    echo "Deployment aborted."
    exit 1
  fi
  echo "Application Default Credentials found."
fi

echo "All sanity checks passed!"

# --- Step 1: Update Repository (if not disabled) ---
if [ "$PULL_GIT" = true ]; then
  echo "[1/$([ "$ONLY_RELEASE" = true ] && echo "3" || echo "4")] Pulling latest changes from git..."
  git pull
  echo "Git pull complete."
else
  echo "[1/$([ "$ONLY_RELEASE" = true ] && echo "3" || echo "4")] Skipping git pull (--no-pull option specified)."
fi

# --- Step 2: Build and Push Image (once for all profiles) ---
# Get short git SHA
GIT_SHA=$(git rev-parse --short HEAD)

# Construct the full image paths (no profile suffix)
FULL_IMAGE_PATH_LATEST="${REGISTRY}/${IMAGE_GROUP}/${IMAGE_NAME}:latest"
FULL_IMAGE_PATH_SHA="${REGISTRY}/${IMAGE_GROUP}/${IMAGE_NAME}:${GIT_SHA}"

echo "[2/$([ "$ONLY_RELEASE" = true ] && echo "3" || echo "4")] Building container image (${FULL_IMAGE_PATH_LATEST})..."
echo "This image will be used for all profiles: ${PROFILES[*]}"
docker buildx build \
        --platform "${PLATFORM}" \
        --file "${DOCKERFILE}" \
        --tag "${FULL_IMAGE_PATH_LATEST}" \
        --tag "${FULL_IMAGE_PATH_SHA}" \
        --push \
        .
echo "Build and push complete."

# --- Step 3: Deploy to GKE via Pulumi (skip if --only-release) ---
if [ "$ONLY_RELEASE" = true ]; then
  echo "--- Release-only build for profiles '${PROFILES[*]}' completed successfully! ---"
  echo "Docker images '${FULL_IMAGE_PATH_LATEST}' and '${FULL_IMAGE_PATH_SHA}' have been built and pushed to registry."
  exit 0
fi

DOCKER_IMAGE_WITH_SHA="${FULL_IMAGE_PATH_SHA}"

echo "[3/4] Deploying to GKE via Pulumi for ${#PROFILES[@]} profile(s)..."
echo "Using Docker image: ${DOCKER_IMAGE_WITH_SHA}"

# Change to Pulumi directory
cd "${PULUMI_DIR}"

# Deploy to each profile
PROFILE_COUNT=0
for PROFILE in "${PROFILES[@]}"; do
  PROFILE_COUNT=$((PROFILE_COUNT + 1))
  STACK_NAME="${IMAGE_NAME}-${PROFILE}"

  echo "--- Deploying profile ${PROFILE_COUNT}/${#PROFILES[@]}: ${PROFILE} (stack: ${STACK_NAME}) ---"

  pulumi --stack "${STACK_NAME}" up \
      --config "s555-iac:dockerImage=${DOCKER_IMAGE_WITH_SHA}" --yes

  echo "Profile '${PROFILE}' deployment completed successfully!"
done

echo "--- GKE deployment for all profiles '${PROFILES[*]}' completed successfully! ---"
echo "Docker image '${DOCKER_IMAGE_WITH_SHA}' has been deployed to ${#PROFILES[@]} profile(s)."

# --- Step 4: Commit and Push Updated Stack Files ---
echo "[4/4] Committing and pushing updated stack files..."

# Check if there are any changes to commit
if git diff --quiet && git diff --cached --quiet; then
  echo "No changes detected in stack files. Nothing to commit."
else
  echo "Changes detected in stack files. Committing and pushing..."

  # Stage only the stack files this deploy rewrote, never anything else in the checkout.
  git add Pulumi.*.yaml

  # Create commit message with docker image info
  COMMIT_MSG="Update stack configurations with docker image ${DOCKER_IMAGE_WITH_SHA}

Deployed to profiles: ${PROFILES[*]}
Deployment completed at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

  # Commit the changes
  git commit -m "${COMMIT_MSG}"

  # Push to main, rebasing and retrying if the remote moved ahead during the deploy.
  # Concurrent deploys only touch their own stack files, so a rebase integrates cleanly.
  echo "Pushing changes to main branch..."
  PUSH_ATTEMPTS=5
  PUSH_SUCCEEDED=false
  for ((ATTEMPT = 1; ATTEMPT <= PUSH_ATTEMPTS; ATTEMPT++)); do
    if git push origin main; then
      PUSH_SUCCEEDED=true
      echo "Successfully pushed stack file updates to main branch."
      break
    fi

    if [ "$ATTEMPT" -lt "$PUSH_ATTEMPTS" ]; then
      echo "Push rejected (attempt ${ATTEMPT}/${PUSH_ATTEMPTS}); remote main moved ahead. Rebasing and retrying..."
      if ! git pull --rebase origin main; then
        echo "Rebase hit conflicts that cannot be resolved automatically. Aborting rebase."
        git rebase --abort || true
        break
      fi
    fi
  done

  if [ "$PUSH_SUCCEEDED" != true ]; then
    echo "------------------------------------------------------------"
    echo "Warning: Failed to push changes to main branch after ${PUSH_ATTEMPTS} attempts!"
    echo "         This might be due to conflicts or the branch being behind remote."
    echo "         The deployment was successful, but stack files were not pushed."
    echo "         Please manually resolve and push the changes:"
    echo "         cd ${PULUMI_DIR}"
    echo "         git pull origin main"
    echo "         git push origin main"
    echo "------------------------------------------------------------"
  fi
fi

# Return to original directory
cd - > /dev/null

exit 0
