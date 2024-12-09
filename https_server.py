import http.server
import ssl
import sys
import os
import json


class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/audio/folders':
            self.handle_folders_request()
        else:
            super().do_GET()  # Gestisce le altre richieste normalmente

    def handle_folders_request(self):
        # Directory che contiene le cartelle audio
        audio_dir = os.path.join(os.getcwd(), 'audio')

        if not os.path.exists(audio_dir):
            self.send_error(404, 'Audio directory not found')
            return

        try:
            # Ottieni tutte le sottocartelle nella directory audio
            folders = [
                folder for folder in os.listdir(audio_dir)
                if os.path.isdir(os.path.join(audio_dir, folder))
            ]
            # Invia la risposta con un JSON
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(folders).encode('utf-8'))
        except Exception as e:
            self.send_error(500, f'Error retrieving folders: {str(e)}')


def serve(host, port, cert_fpath, privkey_fpath):
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)  # Might need to use ssl.PROTOCOL_TLS for older versions of Python
    context.load_cert_chain(certfile=cert_fpath, keyfile=privkey_fpath, password='')
    server_address = (host, port)
    httpd = http.server.HTTPServer(server_address, CustomHandler)  # Usa CustomHandler
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    httpd.serve_forever()


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(f'Usage:\n  {sys.argv[0]} <port> <PEM certificate file> <private key file>')
        sys.exit()

    PORT = int(sys.argv[1])
    CERT_FPATH = sys.argv[2]
    PRIVKEY_FPATH = sys.argv[3]

    serve('0.0.0.0', PORT, CERT_FPATH, PRIVKEY_FPATH)
