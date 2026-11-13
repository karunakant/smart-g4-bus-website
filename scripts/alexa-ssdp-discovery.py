#!/usr/bin/env python3
"""
Alexa SSDP UPnP Multicast Discovery Responder (Zero Hardcoded IPs)
-----------------------------------------------------------------
Amazon Echo devices search for Philips Hue bridges using SSDP M-SEARCH
UDP multicast on 239.255.255.250:1900.

This script runs on the host network, automatically and dynamically detects
the host's active LAN IP from the network interface routing table, and
responds to Amazon Echo discovery requests with zero hardcoded IP addresses.
"""

import socket
import struct
import sys
import time
import json
import os

MCAST_GRP = '239.255.255.250'
MCAST_PORT = 1900

def get_bridge_identifiers(ip):
    """
    Derives unique Bridge ID and UUID from the host IP suffix.
    Guarantees zero network collisions even if multiple bridges (e.g. Raspberry Pi + PC) run on the same LAN.
    """
    suffix = ip.split('.')[-1].zfill(2)[-2:]
    bridge_id = f'001788FFFE09D7{suffix.upper()}'
    bridge_uuid = f'2f402f80-da50-11e1-9b23-00178809d7{suffix.lower()}'
    return bridge_id, bridge_uuid

def get_dynamic_ip(target_ip='8.8.8.8'):
    """
    Dynamically identifies the host's active IPv4 address on the network
    interface that routes traffic to target_ip. Zero hardcoding.
    """
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect((target_ip, 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith('127.'):
            return ip
    except Exception:
        pass

    # Fallback to scanning active network interfaces
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if not ip.startswith('127.') and not ip.startswith('169.254.'):
                return ip
    except Exception:
        pass

    return '127.0.0.1'

def sync_central_network(detected_ip):
    """
    Saves dynamic host IP to central data/network.json and .env so that
    Docker containers, Node backend, and host scripts share one central source of truth.
    """
    if not detected_ip or detected_ip.startswith('127.'):
        return

    # 1. Save to central shared volume file: data/network.json
    try:
        network_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'network.json')
        os.makedirs(os.path.dirname(network_path), exist_ok=True)
        data = {
            "hostIp": detected_ip,
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source": "dynamic_host_discovery"
        }
        with open(network_path, 'w') as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass

    # 2. Update .env for Docker Compose
    try:
        env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
        lines = []
        found = False
        if os.path.exists(env_path):
            with open(env_path, 'r') as f:
                for line in f:
                    if line.strip().startswith('HOST_IP='):
                        lines.append(f'HOST_IP={detected_ip}\n')
                        found = True
                    else:
                        lines.append(line)
        if not found:
            lines.append(f'HOST_IP={detected_ip}\n')
        with open(env_path, 'w') as f:
            f.writelines(lines)
    except Exception:
        pass

def build_ssdp_packets(host_ip, port):
    bridge_id, bridge_uuid = get_bridge_identifiers(host_ip)
    base_headers = [
        "HTTP/1.1 200 OK",
        "HOST: 239.255.255.250:1900",
        "CACHE-CONTROL: max-age=100",
        "EXT:",
        f"LOCATION: http://{host_ip}:{port}/description.xml",
        "SERVER: FreeRTOS/7.4.2 UPnP/1.0 IpBridge/1.17.0",
        f"hue-bridgeid: {bridge_id}"
    ]

    resp_basic = "\r\n".join(base_headers + [
        "ST: urn:schemas-upnp-org:device:basic:1",
        f"USN: uuid:{bridge_uuid}::urn:schemas-upnp-org:device:basic:1",
        "", ""
    ]).encode('utf-8')

    resp_basic_cap = "\r\n".join(base_headers + [
        "ST: urn:schemas-upnp-org:device:Basic:1",
        f"USN: uuid:{bridge_uuid}::urn:schemas-upnp-org:device:Basic:1",
        "", ""
    ]).encode('utf-8')

    resp_root = "\r\n".join(base_headers + [
        "ST: upnp:rootdevice",
        f"USN: uuid:{bridge_uuid}::upnp:rootdevice",
        "", ""
    ]).encode('utf-8')

    resp_uuid = "\r\n".join(base_headers + [
        f"ST: uuid:{bridge_uuid}",
        f"USN: uuid:{bridge_uuid}",
        "", ""
    ]).encode('utf-8')

    return [resp_basic, resp_basic_cap, resp_root, resp_uuid]

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import threading

class HueProxyHandler(BaseHTTPRequestHandler):
    backend_port = 3000

    def do_GET(self):
        self.proxy_request('GET')

    def do_POST(self):
        self.proxy_request('POST')

    def do_PUT(self):
        self.proxy_request('PUT')

    def proxy_request(self, method):
        target_url = f"http://127.0.0.1:{self.backend_port}{self.path}"
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length) if content_length > 0 else None
            
            headers = {k: v for k, v in self.headers.items() if k.lower() not in ['host', 'content-length']}
            headers['Host'] = self.headers.get('Host', '')

            req = urllib.request.Request(target_url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=5) as resp:
                self.send_response(resp.status)
                for k, v in resp.getheaders():
                    if k.lower() not in ['transfer-encoding']:
                        self.send_header(k, v)
                self.end_headers()
                self.wfile.write(resp.read())
        except Exception as e:
            self.send_response(502)
            self.end_headers()
            self.wfile.write(f"Proxy error: {e}".encode('utf-8'))

    def log_message(self, format, *args):
        print(f"[Alexa Bridge HTTP Proxy] {self.address_string()} - {format % args}", flush=True)

def start_http_proxy(port=80, backend_port=3000):
    try:
        HueProxyHandler.backend_port = backend_port
        httpd = HTTPServer(('0.0.0.0', port), HueProxyHandler)
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        print(f"[Alexa Bridge] Host HTTP proxy online on Port {port} -> 127.0.0.1:{backend_port}", flush=True)
        return httpd
    except Exception as e:
        print(f"[Alexa Bridge] Host Port {port} proxy status: {e}", flush=True)
        return None

def main():
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 80
    initial_ip = sys.argv[1] if (len(sys.argv) > 1 and sys.argv[1] != 'auto') else get_dynamic_ip()

    sync_central_network(initial_ip)

    print("=" * 65, flush=True)
    print(" SmartBus G4 - Alexa SSDP Discovery Responder (Dynamic LAN IP)", flush=True)
    print(f" Dynamic LAN IP       : {initial_ip}", flush=True)
    print(f" Advertised Bridge URL: http://{initial_ip}:{port}/description.xml", flush=True)
    print(f" Multicast Group      : {MCAST_GRP}:{MCAST_PORT}", flush=True)
    print("=" * 65, flush=True)

    # Start host-side HTTP proxy on Port 80 (bypasses Windows Firewall Docker restrictions)
    start_http_proxy(port=port, backend_port=3000)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(('', MCAST_PORT))

    # Join multicast specifically on the active LAN IP interface (not just INADDR_ANY, which picks WSL virtual adapter on Windows)
    try:
        mreq_if = struct.pack('4s4s', socket.inet_aton(MCAST_GRP), socket.inet_aton(initial_ip))
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq_if)
        print(f"[Alexa Bridge] Joined multicast group {MCAST_GRP} on physical interface {initial_ip}", flush=True)
    except Exception as e:
        print(f"[Alexa Bridge] Interface join warning for {initial_ip}: {e}", flush=True)

    try:
        mreq_any = struct.pack('4sl', socket.inet_aton(MCAST_GRP), socket.INADDR_ANY)
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq_any)
    except Exception:
        pass

    print("[Ready] Dynamically listening for Amazon Echo 'Discover Devices'...", flush=True)
    print("Zero hardcoded IPs. Press Ctrl+C to stop.\n", flush=True)

    while True:
        try:
            data, addr = sock.recvfrom(2048)
            msg = data.decode('utf-8', errors='ignore')
            if 'M-SEARCH' in msg and any(x in msg.lower() for x in ['ssdp:discover', 'ssdp:all', 'rootdevice', 'basic:1', 'device:basic']):
                # Dynamically resolve host IP on the specific subnet connecting to the Echo
                echo_ip = addr[0]
                active_ip = get_dynamic_ip(echo_ip)
                sync_central_network(active_ip)

                st_header = next((line for line in msg.splitlines() if line.upper().startswith('ST:')), 'ST: unknown')
                print(f"[Alexa Bridge] SSDP M-SEARCH received from {echo_ip}:{addr[1]} ({st_header.strip()})", flush=True)

                packets = build_ssdp_packets(active_ip, port)

                for pkt in packets:
                    sock.sendto(pkt, addr)
                time.sleep(0.08)
                for pkt in packets:
                    sock.sendto(pkt, addr)
                print(f"[Alexa Bridge] -> Responded with Hue bridge at http://{active_ip}:{port}/description.xml to {echo_ip}", flush=True)
        except KeyboardInterrupt:
            print("\nShutting down Alexa SSDP listener.")
            break
        except Exception as e:
            print(f"[Alexa Bridge] Warning: {e}", flush=True)

if __name__ == '__main__':
    main()
