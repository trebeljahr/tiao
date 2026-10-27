"""Add or remove only this job's signing keychain; preserve all other entries."""
import shlex
import subprocess
import sys


def update(operation, keychain):
    if operation not in ("add", "remove"):
        raise ValueError("Choose add or remove.")
    current = shlex.split(subprocess.check_output(
        ["security", "list-keychains", "-d", "user"], text=True))
    updated = [path for path in current if path != keychain]
    if operation == "add":
        updated.insert(0, keychain)
    if updated != current:
        subprocess.run(["security", "list-keychains", "-d", "user", "-s", *updated], check=True)


if __name__ == "__main__":
    update(*sys.argv[1:])
