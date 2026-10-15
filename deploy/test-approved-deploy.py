#!/usr/bin/env python3
"""Guardrail tests for the manually approved VDS deployment entrypoint.

These assertions intentionally do not access a live server. Staging fault
injection and real rollback testing are separate release gates.
"""
from pathlib import Path
import re
import unittest

SCRIPT = Path(__file__).with_name("approved-deploy.sh").read_text()
WORKFLOW = (Path(__file__).resolve().parents[1] / ".github/workflows/deploy-production.yml").read_text()


class DeploymentGuardTests(unittest.TestCase):
    def test_manual_only(self):
        self.assertRegex(WORKFLOW, r"(?m)^  workflow_dispatch:")
        self.assertNotRegex(WORKFLOW, r"(?m)^  push:")
        self.assertIn("refs/heads/main", WORKFLOW)
        self.assertIn("environment: production", WORKFLOW)

    def test_fixed_privileged_entrypoint(self):
        self.assertIn("/usr/local/sbin/lms-approved-deploy", WORKFLOW)
        self.assertNotIn("sudo -n bash -s", WORKFLOW)
        self.assertIn("StrictHostKeyChecking=yes", WORKFLOW)

    def test_validates_exact_main_sha(self):
        self.assertIn('[[ "$TARGET" =~ ^[a-f0-9]{40}$ ]]', SCRIPT)
        self.assertIn('git rev-parse origin/main', SCRIPT)
        self.assertIn('git merge-base --is-ancestor', SCRIPT)
        self.assertIn('git merge --ff-only', SCRIPT)
        self.assertNotIn("git reset --hard", SCRIPT)

    def test_rejects_schema_and_dependency_changes(self):
        for item in ("server/migrations/*", "package-lock.json", "server/package.json"):
            self.assertIn(item, SCRIPT)
        self.assertNotIn("npm ci", re.sub(r"^#.*$", "", SCRIPT, flags=re.M))
        self.assertNotIn("npm run migrate", SCRIPT)

    def test_backup_precedes_checkout_and_publish(self):
        self.assertLess(SCRIPT.index("systemctl stop lms"), SCRIPT.index("pg_dump -Fc"))
        self.assertLess(SCRIPT.index("pg_dump -Fc"), SCRIPT.index('git merge --ff-only "$TARGET"'))
        self.assertLess(SCRIPT.index('rsync -a "$WEB/" "$BACKUP/frontend/"'),
                        SCRIPT.index('rsync -a --checksum --delete --chmod=D755,F644 "$APP/client/dist/" "$WEB/"'))

    def test_failed_deploy_recovers_and_blocks_retries(self):
        self.assertIn('trap rollback ERR', SCRIPT)
        self.assertIn('rsync -a --delete "$BACKUP/server-dist/"', SCRIPT)
        self.assertIn('rsync -a --checksum --delete --chmod=D755,F644 "$BACKUP/frontend/"', SCRIPT)
        self.assertIn("RECONCILE-BEFORE-NEXT-DEPLOY", SCRIPT)
        self.assertIn("if ! systemctl start lms", SCRIPT)


if __name__ == "__main__":
    unittest.main()
