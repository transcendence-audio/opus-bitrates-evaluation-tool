bash encode.sh "$1" "$2"
sudo python3 ./https_server.py 443 ./cert.crt ./private.key