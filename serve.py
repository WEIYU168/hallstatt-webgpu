"""雙擊「啟動遊戲.bat」會執行這個檔案：在本機開一個小型網頁伺服器，並自動用瀏覽器打開遊戲。

為什麼需要伺服器？瀏覽器的安全限制不允許直接從資料夾（file://）載入 JavaScript 模組，
所以直接雙擊 index.html 會一直停在「載入中」。

用法：
  python serve.py              # 自動找空的連接埠並打開瀏覽器
  python serve.py 5180         # 指定連接埠
  python serve.py --no-browser # 只開伺服器、不打開瀏覽器
"""
import http.server
import os
import socket
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    # Windows 登錄檔有時把 .js 設成 text/plain，瀏覽器就會拒絕執行模組；這裡明確指定正確類型
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.md': 'text/markdown; charset=utf-8',
        '.wasm': 'application/wasm',
        '.glb': 'model/gltf-binary',
        '.spz': 'application/octet-stream',
        '.ply': 'application/octet-stream',
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')  # 修改程式後重新整理就能看到最新版本
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 不在視窗裡刷一堆請求紀錄


def free_port(start=5180):
    for port in range(start, start + 60):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    raise SystemExit('找不到可用的連接埠，請關閉其他伺服器後再試一次。')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    port = int(args[0]) if args and args[0].isdigit() else free_port()
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler)
    url = f'http://127.0.0.1:{port}/index.html'
    print(flush=True)
    print('  哈修塔特遊戲伺服器已啟動')
    print(f'  網址：{url}')
    print('  高斯世界版：' + url.replace('index.html', 'splat.html'))
    print(flush=True)
    print('  ※ 玩的時候請保持這個視窗開著；關掉視窗或按 Ctrl+C 就會停止。', flush=True)
    print(flush=True)
    if '--no-browser' not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()
