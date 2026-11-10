"""Start the standalone V2 web app using only Python's standard library."""
import argparse
import functools
import http.server
from pathlib import Path
import threading
import webbrowser


def main():
    parser = argparse.ArgumentParser(description='PackPilot 2.0 local web app')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--no-open', action='store_true')
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent / 'static' / 'v2'
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    except OSError:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    url = f'http://127.0.0.1:{server.server_port}/'
    print(f'PackPilot 2.0 已启动：{url}\n关闭此窗口或按 Ctrl+C 停止。', flush=True)
    if not args.no_open:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
