import json
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

import app


class AppTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = {name: getattr(app, name) for name in
                    ("DATA", "DB_PATH", "WORKSPACES", "MODEL_FILE", "PASSWORD", "SESSION_SECRET")}
        app.DATA = Path(self.temp.name)
        app.DB_PATH = app.DATA / "test.sqlite3"
        app.WORKSPACES = app.DATA / "workspaces"
        app.MODEL_FILE = app.DATA / "models.json"
        app.PASSWORD = "test-password"
        app.SESSION_SECRET = b"x" * 32
        app.MODEL_FILE.write_text(json.dumps({
            "codex": {"label": "Codex", "adapter": "codex", "roles": list(app.ROLES)},
            "review-chat": {"label": "Review", "adapter": "chat", "roles": ["planning", "review"],
                            "model": "review", "endpoint": "http://127.0.0.1:8080/v1"},
        }))
        app.init_db()
        self.payload = {
            "title": "Fix parser", "repo": "example/project", "base_branch": "main",
            "description": "Handle blank lines", "acceptance": "Add a regression test",
            "test_command": "python -m unittest discover",
            "models": {role: "codex" for role in app.ROLES},
        }

    def tearDown(self):
        for name, value in self.old.items():
            setattr(app, name, value)
        self.temp.cleanup()

    def test_model_roles_and_snapshot(self):
        wrong = json.loads(json.dumps(self.payload))
        wrong["models"]["implementation"] = "review-chat"
        with self.assertRaisesRegex(ValueError, "implementation"):
            app.create_task(wrong)
        item = app.create_task(self.payload)
        self.assertEqual(item["status"], "queued")
        self.assertEqual(item["models"]["review"]["adapter"], "codex")
        app.MODEL_FILE.write_text("{}")
        self.assertEqual(app.task(item["id"])["models"]["review"]["label"], "Codex")
        self.assertEqual(len(app.events(item["id"])), 1)

    def test_running_task_pauses_after_restart(self):
        item = app.create_task(self.payload)
        app.change(item["id"], "implementing")
        app.init_db()
        self.assertEqual(app.task(item["id"])["status"], "paused")

    def test_publish_without_api_token_pushes_branch_and_returns_compare_link(self):
        old_token, old_transport = app.GITHUB_TOKEN, app.GIT_TRANSPORT
        app.GITHUB_TOKEN, app.GIT_TRANSPORT = "", "ssh"
        item = {"id": "abc123abc123", "repo": "example/project", "title": "Fix parser",
                "branch": "multiagent/task-abc123abc123", "base_branch": "main", "base_sha": "",
                "description": "Fix", "acceptance": "Test", "test_output": "ok", "review": "ok"}
        path = app.workspace(item)
        remote = app.DATA / "remote.git"
        subprocess.run(["git", "init", "--bare", "-q", str(remote)], check=True)
        subprocess.run(["git", "init", "-q", str(path)], check=True)
        subprocess.run(["git", "-C", str(path), "checkout", "-qb", "main"], check=True)
        (path / "file.txt").write_text("before\n")
        subprocess.run(["git", "-C", str(path), "add", "file.txt"], check=True)
        subprocess.run(["git", "-C", str(path), "-c", "user.name=Test", "-c", "user.email=test@localhost",
                        "commit", "-qm", "initial"], check=True)
        item["base_sha"] = subprocess.run(["git", "-C", str(path), "rev-parse", "HEAD"],
                                          check=True, capture_output=True, text=True).stdout.strip()
        subprocess.run(["git", "-C", str(path), "remote", "add", "origin", str(remote)], check=True)
        subprocess.run(["git", "-C", str(path), "checkout", "-qb", item["branch"]], check=True)
        (path / "file.txt").write_text("after\n")
        try:
            url, created = app.publish(item)
            self.assertFalse(created)
            self.assertIn("github.com/example/project/compare/main...multiagent%2Ftask-abc123abc123", url)
            pushed = subprocess.run(["git", "--git-dir", str(remote), "rev-parse", item["branch"]],
                                    check=True, capture_output=True, text=True).stdout.strip()
            self.assertNotEqual(pushed, item["base_sha"])
        finally:
            app.GITHUB_TOKEN, app.GIT_TRANSPORT = old_token, old_transport

    def test_http_login_and_task_creation(self):
        server = app.AppServer(("127.0.0.1", 0), app.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}"
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with self.assertRaises(urllib.error.HTTPError) as denied:
                opener.open(url + "/api/tasks", timeout=5)
            self.assertEqual(denied.exception.code, 401)
            login = urllib.request.Request(url + "/api/login", data=json.dumps({"password": "test-password"}).encode(),
                                          headers={"Content-Type": "application/json"}, method="POST")
            with opener.open(login, timeout=5) as response:
                cookie = response.headers["Set-Cookie"].split(";", 1)[0]
            request = urllib.request.Request(url + "/api/tasks", data=json.dumps(self.payload).encode(),
                                             headers={"Content-Type": "application/json", "Cookie": cookie}, method="POST")
            with opener.open(request, timeout=5) as response:
                created = json.load(response)
            self.assertEqual(created["repo"], "example/project")
            detail = urllib.request.Request(url + "/api/tasks/" + created["id"], headers={"Cookie": cookie})
            with opener.open(detail, timeout=5) as response:
                self.assertEqual(json.load(response)["title"], "Fix parser")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
