# Servidor estático para desarrollo: igual que `python -m http.server`, pero sin caché,
# para que el navegador cargue siempre la última versión de los módulos JS.
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 5173
ThreadingHTTPServer(('', port), NoCacheHandler).serve_forever()
