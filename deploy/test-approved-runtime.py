#!/usr/bin/env python3
"""Run the production deploy control flow against disposable fake services.

No actual database, service or public host is accessed; paths are rewritten in
a temporary script copy and process commands are stubs. Run as root in CI.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = (ROOT / "deploy/approved-deploy.sh").read_text()
OLD = "a" * 40
NEW = "b" * 40


class DeployFaultInjection(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="lms-deploy-test-")
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.base = base
        self.app = base / "app"
        self.web = base / "web"
        self.backups = base / "backups"
        self.bin = base / "bin"
        self.bin.mkdir()
        for d in ("server/dist", "server/uploads", "client/dist", "node_modules"):
            (self.app / d).mkdir(parents=True)
        (self.app / "server/dist/index.js").write_text("OLD_SERVER")
        (self.app / "client/dist/index.html").write_text("NEW_CLIENT")
        self.web.mkdir()
        (self.web / "index.html").write_text("OLD_CLIENT")
        (base / "head").write_text(OLD)
        (base / "service").write_text("active")
        # Fake all commands that would touch the host. tar and rsync are real
        # and only operate on rewritten disposable paths.
        stubs = {
            "git": """#!/bin/bash
case "$1 $2" in
  'branch --show-current') echo main;;
  'status --porcelain') :;;
  'fetch origin') :;;
  'rev-parse origin/main') echo "$NEW_SHA";;
  'rev-parse HEAD') cat "$SANDBOX/head";;
  'rev-parse --short') head -c 7 "$SANDBOX/head"; echo;;
  'merge-base --is-ancestor') :;;
  'diff --name-only') echo 'server/src/routes/admin-attachments.ts';;
  'merge --ff-only') echo "$NEW_SHA" > "$SANDBOX/head";;
  *) echo "Unsupported git $*" >&2; exit 23;;
esac
""",
            "systemctl": """#!/bin/bash
case "$1" in
  is-active) test "$(cat "$SANDBOX/service")" = active;;
  stop) echo inactive > "$SANDBOX/service";;
  start) echo active > "$SANDBOX/service";;
  *) exit 21;;
esac
""",
            "sudo": """#!/bin/bash
test "$1 $2 $3" = "-u postgres pg_dump" || exit 12
echo MOCK_DUMP
""",
            "pg_dump": "#!/bin/bash\necho MOCK_DUMP\n",
            "pg_restore": "#!/bin/bash\necho MOCK_CATALOG\n",
            "npm": """#!/bin/bash
test "$1 $2" = "run build" || exit 17
if [[ "$FAIL_BUILD" == "1" ]]; then
 echo BROKEN_SERVER > "$SANDBOX/app/server/dist/index.js"
 exit 19
fi
echo NEW_SERVER > "$SANDBOX/app/server/dist/index.js"
""",
            "curl": """#!/bin/bash
case "${!#}" in
  *index.html) echo '<div id="root"></div>';;
  *) echo '{"status":"ok"}';;
esac
""",
        }
        for name, stub in stubs.items():
            p = self.bin / name
            p.write_text(stub)
            p.chmod(0o755)
        script = ORIGINAL.replace('export PATH="/opt/node24/bin:$PATH"', 'export PATH="$PATH"')
        script = script.replace('APP=/opt/lms', f'APP={self.app}')
        script = script.replace('WEB=/var/www/lms/client-dist', f'WEB={self.web}')
        script = script.replace('BACKUPS=/var/backups/lms', f'BACKUPS={self.backups}')
        self.script = base / "approved-deploy.sh"
        self.script.write_text(script)
        self.script.chmod(0o700)
        self.env = dict(os.environ, PATH=str(self.bin)+os.pathsep+os.environ["PATH"],
                        SANDBOX=str(base), NEW_SHA=NEW, FAIL_BUILD="0")

    def run_deploy(self, fail=False):
        env = dict(self.env, FAIL_BUILD="1" if fail else "0")
        return subprocess.run(["bash", str(self.script), NEW], env=env,
                              text=True, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=30)

    def test_build_failure_restores_binaries_and_starts_old_service(self):
        result = self.run_deploy(fail=True)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertEqual((self.app / "server/dist/index.js").read_text(), "OLD_SERVER")
        self.assertEqual((self.web / "index.html").read_text(), "OLD_CLIENT")
        self.assertEqual((self.base / "service").read_text().strip(), "active")
        self.assertEqual((self.base / "head").read_text().strip(), NEW)
        self.assertEqual((self.backups / "RECONCILE-BEFORE-NEXT-DEPLOY").read_text().strip(), OLD)
        again = self.run_deploy()
        self.assertNotEqual(again.returncode, 0)
        self.assertIn("reconciliation", again.stderr)

    def test_successful_deployment_keeps_new_binaries(self):
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.app / "server/dist/index.js").read_text().strip(), "NEW_SERVER")
        self.assertEqual((self.web / "index.html").read_text().strip(), "NEW_CLIENT", result.stdout + result.stderr)
        self.assertEqual((self.base / "service").read_text().strip(), "active")
        self.assertFalse((self.backups / "RECONCILE-BEFORE-NEXT-DEPLOY").exists())


if __name__ == "__main__":
    unittest.main()
