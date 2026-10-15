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
