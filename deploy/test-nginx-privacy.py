"""Run the checked-in Nginx configuration against a disposable HTTP upstream.

No external requests, privileged ports, real files or production credentials.
TLS is removed ONLY in this generated test config. CI installs stock Nginx.
"""
import http.server
import pathlib
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


secret = "CI_INVITATION_SECRET_never_log_this"


class Upstream(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        assert secret.encode() in body
        self.send_response(200)
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def log_message(self, *_args):
        pass


with tempfile.TemporaryDirectory(prefix="lms-nginx-test-") as directory:
    root = pathlib.Path(directory)
    (root / "html").mkdir()
    (root / "html/index.html").write_text("<html>LMS test shell</html>")
    port = free_port()
    upstream = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
    upstream_port = upstream.server_port
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    source = pathlib.Path(__file__).with_name("nginx.conf.example").read_text()
    # Keep active map/log_format and the HTTPS server's actual locations.
    first = source.index("server {")
    second = source.index("server {", first + 1)
    source = source[:first] + source[second:]
    source = source.replace("listen 443 ssl http2;", f"listen 127.0.0.1:{port};")
    source = source.replace("listen [::]:443 ssl http2;", "")
    source = source.replace("/var/www/lms/client-dist", str(root / "html"))
    source = source.replace("/var/log/nginx/lms.access.log", str(root / "access.log"))
    source = source.replace("/var/log/nginx/lms.error.log", str(root / "error.log"))
    source = source.replace("http://127.0.0.1:3000/", f"http://127.0.0.1:{upstream_port}/")
    config = root / "nginx.conf"
    config.write_text(f"daemon off; pid {root}/nginx.pid; error_log {root}/master.log warn;\n"
                      f"events {{}}\nhttp {{ client_body_temp_path {root}/body; "
                      f"proxy_temp_path {root}/proxy;\n{source}\n}}\n")
    subprocess.run(["nginx", "-t", "-p", directory + "/", "-c", str(config)], check=True)
    process = subprocess.Popen(["nginx", "-p", directory + "/", "-c", str(config)])

    def request(path, expected, data=None, private=True):
        req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data,
            headers={"Content-Type": "application/json", "Referer": f"/invite/{secret}",
                     "Cookie": f"session={secret}", "Authorization": f"Bearer {secret}",
                     "User-Agent": secret})
        try:
            response = urllib.request.urlopen(req, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            assert response.status == expected, (path, response.status)
            assert response.headers.get("Referrer-Policy") == "no-referrer"
            if private:
                assert response.headers.get("Cache-Control") == "no-store"
            response.read()

    try:
        for _ in range(50):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=.1):
                    break
            except OSError:
                if process.poll() is not None:
                    raise RuntimeError("Nginx did not start")
                time.sleep(.1)
        else:
            raise RuntimeError("Nginx did not listen")
        request(f"/invite/{secret}?token={secret}", 200)
        request(f"/invite/%43I_INVITATION_SECRET_never_log_this", 200)
        request(f"/api/auth/invitations/{secret}/accept", 410)
        for action in ["check", "accept"]:
            request(f"/api/auth/invitations/{action}", 200,
                    f'{{"token":"{secret}","password":"{secret}"}}'.encode())
        # An upstream failure must remain private and cannot log a body token.
        upstream.shutdown()
        upstream.server_close()
        request("/api/auth/invitations/accept", 502, f'{{"token":"{secret}"}}'.encode())
        # Static read failure in a legacy invitation location also stays private.
        (root / "html/index.html").unlink()
        request(f"/invite/{secret}", 404)
    finally:
        process.terminate()
        process.wait(timeout=5)
        upstream.shutdown()
        upstream.server_close()
    access = (root / "access.log").read_text()
    errors = "".join(path.read_text() for path in root.glob("*.log"))
    assert access and " 502 " in access and " 410 " in access
    assert secret not in errors, errors
    print("Nginx privacy: config, legacy/encoded URLs, body POST, 404/410/502 and logs passed")
