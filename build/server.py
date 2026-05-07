"""Local dev server with COOP/COEP headers required for ffmpeg.wasm multi-threaded mode."""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        super().end_headers()

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"➜ http://localhost:{PORT}")
    print("  COOP/COEP headers enabled (ffmpeg.wasm multi-thread compatible)")
    httpd.serve_forever()
