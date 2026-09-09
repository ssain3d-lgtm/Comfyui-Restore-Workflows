from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from aiohttp import web
import folder_paths
from server import PromptServer


PREFIX = "[Restore Workflows]"
POLL_SECONDS = 2.0
DEBOUNCE_SECONDS = 6.0
MAX_DIRTY_SECONDS = 60.0
MAX_DIFF_CHARS = 1_000_000
MAX_FILE_CHARS = 1_000_000
HASH_RE = re.compile(r"^[0-9a-fA-F]{7,40}$")


class WorkflowGitError(RuntimeError):
    pass


class WorkflowGitManager:
    def __init__(self) -> None:
        self.repo = Path(folder_paths.get_user_directory()) / "default" / "workflows"
        self.git = shutil.which("git")
        self.lock = threading.RLock()
        self.stop_event = threading.Event()
        self.ready = False
        self.error: str | None = None

        try:
            self._ensure_repo()
            self.ready = True
            self._start_watcher()
        except Exception as exc:
            self.error = str(exc)
            print(f"{PREFIX} disabled: {exc}")

    def _run_git(
        self,
        *args: str,
        check: bool = False,
        text: bool = True,
    ) -> subprocess.CompletedProcess:
        if not self.git:
            raise WorkflowGitError(
                "git was not found. Install Git and make sure it is available in PATH."
            )

        creationflags = 0
        if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
            creationflags = subprocess.CREATE_NO_WINDOW

        result = subprocess.run(
            [self.git, *args],
            cwd=str(self.repo),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=text,
            encoding="utf-8" if text else None,
            errors="replace" if text else None,
            creationflags=creationflags,
        )

        if check and result.returncode != 0:
            stderr = result.stderr.strip() if text and result.stderr else ""
            stdout = result.stdout.strip() if text and result.stdout else ""
            raise WorkflowGitError(stderr or stdout or f"git {' '.join(args)} failed")

        return result

    def _ensure_repo(self) -> None:
        self.repo.mkdir(parents=True, exist_ok=True)

        if not self.git:
            raise WorkflowGitError(
                "Git is required. Install it and restart ComfyUI."
            )

        with self.lock:
            if not (self.repo / ".git").exists():
                self._run_git("init", check=True)
                print(f"{PREFIX} git init: {self.repo}")

            self._verify_repo_root()

            # Repository-local only. User/global Git settings are not changed.
            if self._run_git("config", "--get", "user.name").returncode != 0:
                self._run_git(
                    "config", "user.name", "ComfyUI Workflow Backup", check=True
                )
            if self._run_git("config", "--get", "user.email").returncode != 0:
                self._run_git(
                    "config",
                    "user.email",
                    "comfyui-workflow-backup@local",
                    check=True,
                )

            self._run_git("config", "core.autocrlf", "false", check=True)
            self._run_git("config", "core.filemode", "false", check=True)

            # Ignore OS junk without creating a .gitignore inside the workflows folder.
            exclude = self.repo / ".git" / "info" / "exclude"
            exclude.parent.mkdir(parents=True, exist_ok=True)
            existing = exclude.read_text(encoding="utf-8", errors="ignore") if exclude.exists() else ""
            marker = "# Comfyui-Restore-Workflows"
            if marker not in existing:
                with exclude.open("a", encoding="utf-8") as f:
                    if existing and not existing.endswith("\n"):
                        f.write("\n")
                    f.write(
                        f"{marker}\n"
                        "Thumbs.db\n"
                        ".DS_Store\n"
                    )

            has_head = (
                self._run_git("rev-parse", "--verify", "HEAD").returncode == 0
            )
            if not has_head:
                self._run_git("add", "-A", check=True)
                stamp = self._now()
                self._run_git(
                    "commit",
                    "--allow-empty",
                    "-m",
                    f"Initial workflow snapshot {stamp}",
                    check=True,
                )
                print(f"{PREFIX} initial snapshot created")
            else:
                self.commit_if_dirty("Startup snapshot")

    def _verify_repo_root(self) -> None:
        """Refuse to operate unless the workflows folder is its own repository.

        restore() deletes files, so an inherited outer repository - a stray
        .git pointer file, a workflows folder restored inside another repo -
        must never become the target.
        """
        toplevel = self._run_git(
            "rev-parse", "--show-toplevel", check=True
        ).stdout.strip()
        if not toplevel:
            raise WorkflowGitError("Could not determine the Git repository root.")

        def norm(value: str) -> str:
            return os.path.normcase(os.path.realpath(value))

        if norm(toplevel) != norm(str(self.repo)):
            raise WorkflowGitError(
                f"{self.repo} belongs to the Git repository at {toplevel}. "
                "The workflows folder must be its own repository."
            )

    @staticmethod
    def _parse_name_status(lines: list[str]) -> list[dict[str, str]]:
        files: list[dict[str, str]] = []
        for line in lines:
            if not line.strip():
                continue
            cols = line.split("\t")
            status = cols[0]
            if status.startswith("R") and len(cols) >= 3:
                files.append(
                    {"status": status, "path": cols[2], "old_path": cols[1]}
                )
            elif len(cols) >= 2:
                files.append({"status": status, "path": cols[1]})
        return files

    @staticmethod
    def _now() -> str:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def _status_porcelain(self) -> str:
        result = self._run_git(
            "status", "--porcelain=v1", "--untracked-files=all", check=True
        )
        return result.stdout

    def commit_if_dirty(self, label: str = "Auto backup") -> dict[str, Any] | None:
        with self.lock:
            status = self._status_porcelain()
            if not status.strip():
                return None

            self._run_git("add", "-A", check=True)
            if self._run_git("diff", "--cached", "--quiet").returncode == 0:
                return None

            changed_count = len(
                [line for line in status.splitlines() if line.strip()]
            )
            message = f"{label} {self._now()} ({changed_count} changed)"
            self._run_git("commit", "-m", message, check=True)
            head = self._head()
            print(f"{PREFIX} {message}")
            return head

    def _snapshot(self) -> dict[str, tuple[int, int]]:
        snapshot: dict[str, tuple[int, int]] = {}
        if not self.repo.exists():
            return snapshot

        for dirpath, dirnames, filenames in os.walk(self.repo):
            dirnames[:] = [d for d in dirnames if d != ".git"]
            base = Path(dirpath)

            for filename in filenames:
                path = base / filename
                try:
                    stat = path.stat()
                    rel = path.relative_to(self.repo).as_posix()
                    snapshot[rel] = (stat.st_mtime_ns, stat.st_size)
                except (FileNotFoundError, PermissionError, OSError):
                    continue

        return snapshot

    def _start_watcher(self) -> None:
        thread = threading.Thread(
            target=self._watch_loop,
            name="ComfyUI-Workflow-Git-Watcher",
            daemon=True,
        )
        thread.start()
        print(
            f"{PREFIX} watching {self.repo} "
            f"(auto commit after {DEBOUNCE_SECONDS:.0f}s idle)"
        )

    def _watch_loop(self) -> None:
        previous = self._snapshot()
        dirty_since: float | None = None
        last_change: float | None = None

        while not self.stop_event.wait(POLL_SECONDS):
            try:
                now = time.monotonic()
                current = self._snapshot()
                if current != previous:
                    previous = current
                    last_change = now
                    if dirty_since is None:
                        dirty_since = now

                if dirty_since is None:
                    continue

                # Commit once the folder goes quiet, but never postpone past
                # MAX_DIRTY_SECONDS: a folder touched on every poll would
                # otherwise keep resetting the debounce and never get backed up.
                if (
                    now - last_change >= DEBOUNCE_SECONDS
                    or now - dirty_since >= MAX_DIRTY_SECONDS
                ):
                    self.commit_if_dirty("Auto backup")
                    previous = self._snapshot()
                    dirty_since = last_change = None
            except Exception as exc:
                print(f"{PREFIX} watcher error: {exc}")

    def _head(self) -> dict[str, str]:
        result = self._run_git(
            "log",
            "-1",
            "--date=iso-strict",
            "--pretty=format:%H%x1f%h%x1f%aI%x1f%s",
            check=True,
        )
        parts = result.stdout.split("\x1f", 3)
        if len(parts) != 4:
            return {}
        return {
            "hash": parts[0],
            "short_hash": parts[1],
            "timestamp": parts[2],
            "subject": parts[3],
        }

    def head(self) -> dict[str, str]:
        with self.lock:
            return self._head()

    def status(self) -> dict[str, Any]:
        if not self.ready:
            return {
                "ready": False,
                "error": self.error or "unknown error",
                "repo": str(self.repo),
                "git": self.git,
            }

        with self.lock:
            count = self._run_git(
                "rev-list", "--count", "HEAD", check=True
            ).stdout.strip()
            return {
                "ready": True,
                "repo": str(self.repo),
                "git": self.git,
                "dirty": bool(self._status_porcelain().strip()),
                "commit_count": int(count or "0"),
                "head": self._head(),
                "poll_seconds": POLL_SECONDS,
                "debounce_seconds": DEBOUNCE_SECONDS,
            }

    def list_commits(self, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 500))
        with self.lock:
            result = self._run_git(
                "log",
                f"-n{limit}",
                "--date=iso-strict",
                "--pretty=format:@@COMMIT@@%n%H%x1f%h%x1f%aI%x1f%s",
                "--name-status",
                "--find-renames",
                "--",
                ".",
                check=True,
            )

        commits: list[dict[str, Any]] = []
        for block in result.stdout.split("@@COMMIT@@\n"):
            block = block.strip()
            if not block:
                continue

            lines = block.splitlines()
            meta = lines[0].split("\x1f", 3)
            if len(meta) != 4:
                continue

            files = self._parse_name_status(lines[1:])

            commits.append(
                {
                    "hash": meta[0],
                    "short_hash": meta[1],
                    "timestamp": meta[2],
                    "subject": meta[3],
                    "files": files,
                    "file_count": len(files),
                }
            )

        return commits

    def _validate_commit(self, commit_hash: str) -> str:
        if not HASH_RE.fullmatch(commit_hash or ""):
            raise WorkflowGitError("Invalid commit ID.")

        result = self._run_git(
            "rev-parse", "--verify", f"{commit_hash}^{{commit}}"
        )
        if result.returncode != 0:
            raise WorkflowGitError("Commit does not exist.")

        full_hash = result.stdout.strip()
        # Only allow commits reachable from this repository's current history.
        ancestor = self._run_git(
            "merge-base", "--is-ancestor", full_hash, "HEAD"
        )
        if ancestor.returncode != 0:
            raise WorkflowGitError("This commit is not part of the current Workflow Git history.")

        return full_hash

    def commit_detail(self, commit_hash: str) -> dict[str, Any]:
        full_hash = self._validate_commit(commit_hash)
        with self.lock:
            # Metadata and the changed-file list in a single call. Scanning the
            # whole log to find this one commit's files was O(history) per click.
            summary = self._run_git(
                "show",
                "--date=iso-strict",
                "--format=%H%x1f%h%x1f%aI%x1f%s",
                "--name-status",
                "--find-renames",
                "--no-ext-diff",
                full_hash,
                "--",
                ".",
                check=True,
            ).stdout.splitlines()

            meta = summary[0].split("\x1f", 3) if summary else []
            if len(meta) != 4:
                raise WorkflowGitError("Could not read commit information.")
            files = self._parse_name_status(summary[1:])

            diff = self._run_git(
                "show",
                "--format=",
                "--find-renames",
                "--no-ext-diff",
                "--unified=3",
                full_hash,
                "--",
                ".",
                check=True,
            ).stdout

            truncated = len(diff) > MAX_DIFF_CHARS
            if truncated:
                diff = diff[:MAX_DIFF_CHARS] + "\n\n... [diff truncated]"

        return {
            "hash": meta[0],
            "short_hash": meta[1],
            "timestamp": meta[2],
            "subject": meta[3],
            "files": files,
            "diff": diff,
            "diff_truncated": truncated,
        }

    def file_at_commit(self, commit_hash: str, path: str) -> dict[str, Any]:
        full_hash = self._validate_commit(commit_hash)
        path = (path or "").replace("\\", "/").lstrip("/")
        if not path or path.startswith(".git/") or "/../" in f"/{path}/":
            raise WorkflowGitError("Invalid file path.")

        with self.lock:
            names = self._run_git(
                "ls-tree", "-r", "--name-only", full_hash, check=True
            ).stdout.splitlines()

            if path not in names:
                return {
                    "path": path,
                    "exists": False,
                    "content": "",
                    "truncated": False,
                }

            result = self._run_git(
                "show", f"{full_hash}:{path}", check=True
            )
            content = result.stdout
            truncated = len(content) > MAX_FILE_CHARS
            if truncated:
                content = content[:MAX_FILE_CHARS] + "\n\n... [file truncated]"

        return {
            "path": path,
            "exists": True,
            "content": content,
            "truncated": truncated,
        }

    def restore(self, commit_hash: str) -> dict[str, Any]:
        full_hash = self._validate_commit(commit_hash)

        with self.lock:
            # Preserve every on-disk change before touching the working tree.
            safety = self.commit_if_dirty("Safety snapshot before restore")
            target = self._run_git(
                "show",
                "-s",
                "--pretty=format:%h%x1f%s",
                full_hash,
                check=True,
            ).stdout.split("\x1f", 1)
            short_hash = target[0]
            subject = target[1] if len(target) > 1 else ""

            # Restore index + working tree to the exact tracked tree of target.
            # Because we commit all current files first, files not present in the
            # target are tracked and are therefore removed by this restore.
            self._run_git(
                "restore",
                f"--source={full_hash}",
                "--staged",
                "--worktree",
                "--",
                ".",
                check=True,
            )

            # If target equals current tree, still keep an auditable restore event.
            message = (
                f"Restore workflows to {short_hash} - {subject} "
                f"({self._now()})"
            )
            self._run_git(
                "commit",
                "--allow-empty",
                "-m",
                message,
                check=True,
            )

            head = self._head()
            print(f"{PREFIX} {message}")

        return {
            "restored_to": full_hash,
            "new_head": head,
            "safety_snapshot": safety,
            "message": message,
        }


manager = WorkflowGitManager()
routes = PromptServer.instance.routes


def json_error(message: str, status: int = 400) -> web.Response:
    return web.json_response({"ok": False, "error": message}, status=status)


@routes.get("/workflow-git/status")
async def workflow_git_status(request: web.Request) -> web.Response:
    try:
        status = await asyncio.to_thread(manager.status)
        return web.json_response({"ok": True, **status})
    except Exception as exc:
        return json_error(str(exc), 500)


@routes.get("/workflow-git/commits")
async def workflow_git_commits(request: web.Request) -> web.Response:
    try:
        limit = int(request.query.get("limit", "100"))
        commits = await asyncio.to_thread(manager.list_commits, limit)
        return web.json_response({"ok": True, "commits": commits})
    except Exception as exc:
        return json_error(str(exc), 500)


@routes.get("/workflow-git/commit/{commit_hash}")
async def workflow_git_commit(request: web.Request) -> web.Response:
    try:
        detail = await asyncio.to_thread(
            manager.commit_detail, request.match_info["commit_hash"]
        )
        return web.json_response({"ok": True, "commit": detail})
    except WorkflowGitError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        return json_error(str(exc), 500)


@routes.get("/workflow-git/file/{commit_hash}")
async def workflow_git_file(request: web.Request) -> web.Response:
    try:
        path = request.query.get("path", "")
        detail = await asyncio.to_thread(
            manager.file_at_commit,
            request.match_info["commit_hash"],
            path,
        )
        return web.json_response({"ok": True, "file": detail})
    except WorkflowGitError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        return json_error(str(exc), 500)


@routes.post("/workflow-git/snapshot")
async def workflow_git_snapshot(request: web.Request) -> web.Response:
    try:
        created = await asyncio.to_thread(
            manager.commit_if_dirty, "Manual snapshot"
        )
        head = created if created is not None else await asyncio.to_thread(
            manager.head
        )
        return web.json_response(
            {
                "ok": True,
                "created": created is not None,
                "head": head,
            }
        )
    except Exception as exc:
        return json_error(str(exc), 500)


@routes.post("/workflow-git/restore")
async def workflow_git_restore(request: web.Request) -> web.Response:
    try:
        body = await request.json()
        commit_hash = body.get("commit", "")
        result = await asyncio.to_thread(manager.restore, commit_hash)
        return web.json_response({"ok": True, **result})
    except WorkflowGitError as exc:
        return json_error(str(exc), 400)
    except Exception as exc:
        return json_error(str(exc), 500)
