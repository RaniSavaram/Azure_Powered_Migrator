"""
Custom runserver: rebuilds the Angular frontend before starting Django.

Django serves the compiled build from FrontEnd/dist/frontend/browser (see
ANGULAR_DIST_DIR in settings), not the source in FrontEnd/src. Without a
rebuild, edits to the Angular code never show up. Use --skip-build to start
the server without rebuilding.
"""
import os
import shutil
import subprocess

from django.conf import settings
from django.contrib.staticfiles.management.commands.runserver import (
    Command as StaticfilesRunserverCommand,
)
from django.core.management.base import CommandError

FRONTEND_DIR = settings.BASE_DIR.parent / "FrontEnd"


class Command(StaticfilesRunserverCommand):
    help = "Builds the Angular frontend, then starts the development server."

    def add_arguments(self, parser):
        super().add_arguments(parser)
        parser.add_argument(
            "--skip-build",
            action="store_true",
            help="Start the server without rebuilding the Angular frontend.",
        )

    def handle(self, *args, **options):
        # The autoreloader re-runs this command in a child process with
        # RUN_MAIN=true; only build once, in the parent.
        if not options["skip_build"] and os.environ.get("RUN_MAIN") != "true":
            self.build_frontend()
        super().handle(*args, **options)

    def build_frontend(self):
        npm = shutil.which("npm")
        if npm is None:
            raise CommandError(
                "npm was not found on PATH; install Node.js or use --skip-build."
            )
        if not (FRONTEND_DIR / "node_modules").exists():
            self.stdout.write("Installing frontend dependencies (npm install)...")
            self._run([npm, "install"])
        self.stdout.write("Building Angular frontend (npm run build)...")
        self._run([npm, "run", "build"])
        self.stdout.write(self.style.SUCCESS("Frontend build complete."))

    def _run(self, cmd):
        result = subprocess.run(cmd, cwd=FRONTEND_DIR)
        if result.returncode != 0:
            raise CommandError(f"'{' '.join(cmd[1:])}' failed; see output above.")
