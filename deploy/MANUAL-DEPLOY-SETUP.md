# Manual production deployment: setup checklist (NOT LIVE)

This workflow is a **draft**. Do not merge or enable it until the server-side script has
been tested on an isolated copy and its rollback / permissions issues are resolved.
It never runs automatically after a merge.

## Repository-side configuration

1. Configure a GitHub **production** Environment with required reviewers and
   restrict deployments to protected `main`.
2. Store these as **Environment secrets**, not in source files:
   - `LMS_DEPLOY_HOST`: the VDS hostname
   - `LMS_DEPLOY_USER`: a dedicated unprivileged SSH user
   - `LMS_DEPLOY_SSH_KEY`: a dedicated Ed25519 private key for this deployment
   - `LMS_DEPLOY_KNOWN_HOSTS`: the server SSH host public key entry, verified
     out of band against the fingerprint directly on the VDS.
3. Never upload `server/.env`, database credentials, private keys, or database
   backups to GitHub.

## VDS-side tasks (one-time, after reviewing draft)

- Create a dedicated SSH user. Add **only its public key** to authorized_keys.
- Permit only the required reviewed deployment script via a restricted sudoers
  rule; do not give the account unrestricted root sudo.
- Confirm `/opt/lms`, the production frontend directory, `lms.service`,
  and the dedicated Node binary match the runbook.
- Keep the previous backend build and the current frontend as rollback artifacts.
- Verify DB + uploads pair with a disposable restore test before enabling.
- Test a failed build, failed healthcheck and clean successful deploy in a
  disposable staging copy; validate rollbacks and directory permissions.
- After security review, enable workflow and try manual Actions → Deploy LMS
  (manual) → Run workflow on `main`.

## Important limits

- The deployment workflow must **never** run migrations or deploy dependency/
  lockfile changes without separate review.
- Rollback of server/frontend alone does not roll back DB data.
- A GitHub Actions success only verifies technical checks; admin UX needs a
  manual acceptance test.
- Until setup and testing are complete, leave PR #38 in draft status.

## Install the reviewed script on VDS (only after merging approved PR)

As root, inspect the main-branch script and then install a *copy* (not a
symlink) into a root-controlled directory:

```sh
cd /opt/lms
git fetch origin main
# Inspect / verify target version before updating the repo.
# After reviewed merge / fast-forward:
install -o root -g root -m 700 deploy/approved-deploy.sh /usr/local/sbin/lms-approved-deploy
bash -n /usr/local/sbin/lms-approved-deploy
```

Install sudoers with `visudo -f /etc/sudoers.d/lms-deploy`. The only
permitted privileged command should be:

```text
lms-deploy ALL=(root) NOPASSWD: /usr/local/sbin/lms-approved-deploy *
```

**Security review required:** sudo's trailing `*` accepts arbitrary arguments,
but the root-owned script rejects anything except a 40-character lowercase
hex SHA and matches it against latest `origin/main`. Stronger isolation should
use a root-owned argument-validation wrapper and a forced SSH command before
enabling on a public host. Do not give the account write permissions to this
file, the repository, `/etc/sudoers.d`, `/var/backups`, or the production
configuration.

For server host verification, read the SSH public host key fingerprint
directly from VDS and independently verify the exact known_hosts public key
before adding it as a secret. `ssh-keyscan` output alone is not trustworthy.

## Reconciliation after failed deployment

The script restores previous backend/frontend binaries and attempts to start
the service. If the checkout was already advanced, it writes
`/var/backups/lms/RECONCILE-BEFORE-NEXT-DEPLOY` and refuses a new deploy.
An operator must inspect and reconcile the checked-out code and deployed
artifacts before clearing that marker; do not delete it merely to retry.

## Remaining gate

Successful GitHub CI / `bash -n` are not proof of safe production deployment.
A disposable staging run must simulate failure during build and after service
start, and confirm a running server on previous binaries. Don't activate
production sudo permissions or merge the draft on the basis of syntax checks.
