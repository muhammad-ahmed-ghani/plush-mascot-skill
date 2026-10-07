#!/usr/bin/env python3
"""Local stub of the OpenAI image endpoints and both Gemini styles, for tests. MOCK_MODE=429-once|400-transparent changes the behaviour."""
import base64, io, json, os, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from PIL import Image

def png(w=64, h=64):
    b = io.BytesIO(); Image.new('RGB', (w, h), (200, 90, 90)).save(b, 'PNG'); return base64.b64encode(b.getvalue()).decode()

class H(BaseHTTPRequestHandler):
    seen = {'429': 0, 'last': None}
    def log_message(self, *a): pass
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        mode = os.environ.get('MOCK_MODE', '')
        H.seen['last'] = {'path': self.path, 'ctype': self.headers.get('Content-Type', ''), 'len': len(body), 'auth': bool(self.headers.get('Authorization') or self.headers.get('x-goog-api-key')),
                          'image_parts': body.count(b'name="image[]"')}
        if mode == '429-once' and H.seen['429'] == 0:
            H.seen['429'] = 1; return self.reply(429, {'error': {'message': 'rate limited'}})
        if mode == '400-transparent' and b'transparent' in body:
            return self.reply(400, {'error': {'message': 'background transparent is not supported'}})
        if '/v1/images/' in self.path:
            return self.reply(200, {'data': [{'b64_json': png()}], 'usage': {'output_tokens': 123}})
        if self.path.endswith('/interactions'):
            return self.reply(200, {'outputs': [{'type': 'image', 'mime_type': 'image/png', 'data': png()}]})
        if ':generateContent' in self.path:
            return self.reply(200, {'candidates': [{'content': {'parts': [{'text': 'ok'}, {'thought': True, 'inlineData': {'mimeType': 'image/png', 'data': png(32, 32)}}, {'inlineData': {'mimeType': 'image/png', 'data': png()}}]}}]})
        self.reply(404, {})
    def reply(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

def start(port=0):
    srv = HTTPServer(('127.0.0.1', port), H); threading.Thread(target=srv.serve_forever, daemon=True).start(); return srv

if __name__ == '__main__':
    s = start(int(sys.argv[1]) if len(sys.argv) > 1 else 4190); print('mock image server on', s.server_address); threading.Event().wait()
