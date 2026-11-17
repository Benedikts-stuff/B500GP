"""APEX dev server: serves the Apex folder on http://localhost:8642 without browser caching,
so changed game files are always picked up on reload."""
import http.server, socketserver, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate'); self.send_header('Expires', '0')
        super().end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', PORT), H) as httpd: httpd.serve_forever()
