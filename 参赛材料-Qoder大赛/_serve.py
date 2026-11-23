import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class H(SimpleHTTPRequestHandler):
    def guess_type(self, path):
        if path.endswith('.md') or path.endswith('.txt'):
            return 'text/plain; charset=utf-8'
        return super().guess_type(path)
    def log_message(self, *a):
        pass
ThreadingHTTPServer(('127.0.0.1', 8900), H).serve_forever()
