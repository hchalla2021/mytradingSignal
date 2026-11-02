"""Regression checks for required backend package files in the Docker context."""

import fnmatch
import unittest
from pathlib import Path


BACKEND = Path(__file__).resolve().parent


class DockerContextTests(unittest.TestCase):
    def test_production_runtime_env_override_matches_token_watcher_mount(self):
        root = BACKEND.parent
        compose = (root / "docker-compose.prod.yml").read_text(encoding="utf-8")
        self.assertIn("env_file:\n      - ${BACKEND_ENV_FILE:-./backend/.env}", compose)
        self.assertIn("- ${BACKEND_ENV_FILE:-./backend/.env}:/app/.env", compose)
        for filename in ("deploy_digitalocean.sh", "scripts/deploy-to-do.ps1"):
            script = (root / filename).read_text(encoding="utf-8")
            self.assertIn('export BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-backend/.env}"', script)
            self.assertIn('bash scripts/check-production-env.sh "$BACKEND_ENV_FILE"', script)
        checker = (root / "scripts/check-production-env.sh").read_text(encoding="utf-8")
        self.assertIn('env_file="${1:-${BACKEND_ENV_FILE:-backend/.env}}"', checker)

    def test_package_initializers_are_not_excluded_with_private_scripts(self):
        rules = [
            line.strip() for line in (BACKEND / ".dockerignore").read_text().splitlines()
            if line.strip() and not line.startswith("#")
        ]

        def excluded(filename):
            ignored = False
            for rule in rules:
                include = rule.startswith("!")
                pattern = rule[1:] if include else rule
                if "/" not in pattern and fnmatch.fnmatchcase(filename, pattern):
                    ignored = not include
            return ignored

        initializers = list(BACKEND.glob("*/__init__.py"))
        self.assertTrue(initializers)
        for initializer in initializers:
            with self.subTest(package=initializer.parent.name):
                self.assertFalse(excluded(initializer.name))
        for filename in ("_debug.py", "test_deployment.py", ".env", ".env.production"):
            with self.subTest(filename=filename):
                self.assertTrue(excluded(filename))


if __name__ == "__main__":
    unittest.main()
