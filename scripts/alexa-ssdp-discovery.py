#!/usr/bin/env python3
"""
Alexa SSDP UPnP Multicast Discovery Responder for Windows Host
--------------------------------------------------------------
Amazon Echo devices search for Philips Hue bridges using SSDP M-SEARCH
UDP multicast on 239.255.255.250:1900.

On Windows, Docker Desktop cannot bind port 1900/udp due to conflicts with
the native Windows 'SSDPSRV' (SSDP Discovery service), and WSL2 does not
pass physical LAN multicast through NAT.

This lightweight script runs directly on the Windows host using SO_REUSEADDR.
It coexists seamlessly with Windows SSDPSRV, detects Echo M-SEARCH broadcasts
on your Wi-Fi/Ethernet network, and immediately responds with your Docker
bridge's location (http://<HOST_IP>:80/description.xml).
"""

import socket
import struct
import sys
import time
import os

MCAST_GRP = '239.255.255.250'
MCAST_PORT = 1900
BRIDGE_ID = '001788FFFE09D74D'
BRIDGE_UUID = '2f402f80-da50-11e1-9b23-00178809d74d'

def get_default_ip():
    # Priority 1: Live outbound interface query (dynamic DHCP auto-detection)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and not ip.startswith('127.'):
            return ip
    except Exception:
        pass

    env_ip = os.environ.get('HOST_IP')
    if env_ip and env_ip.strip():
        return env_ip.strip()

    # Priority 3: Read from .env file if present
    try:
        env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
        if os.path.exists(env_path):
            with open(env_path, 'r') as f:
                for line in f:
                    if line.strip().startswith('HOST_IP='):
                        val = line.strip().split('=', 1)[1].strip()
                        if val:
                            return val
    except Exception:
        pass

    return '192.168.0.18'

def main():
    host_ip = sys.argv[1] if len(sys.argv) > 1 else get_default_ip()
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 80

    print("=" * 65, flush=True)
    print(" SmartBus G4 - Alexa SSDP Discovery Responder (Windows Host)", flush=True)
    print(f" Advertised Hue Bridge: http://{host_ip}:{port}/description.xml", flush=True)
    print(f" Multicast Group      : {MCAST_GRP}:{MCAST_PORT}", flush=True)
    print("=" * 65, flush=True)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(('', MCAST_PORT))

    mreq = struct.pack('4sl', socket.inet_aton(MCAST_GRP), socket.INADDR_ANY)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)

    base_headers = [
        "HTTP/1.1 200 OK",
        "CACHE-CONTROL: max-age=100",
        "EXT:",
        f"LOCATION: http://{host_ip}:{port}/description.xml",
        "SERVER: FreeRTOS/7.4.2 UPnP/1.0 IpBridge/1.17.0",
        f"hue-bridgeid: {BRIDGE_ID}"
    ]

    resp_basic = "\r\n".join(base_headers + [
        "ST: urn:schemas-upnp-org:device:basic:1",
        f"USN: uuid:{BRIDGE_UUID}::urn:schemas-upnp-org:device:basic:1",
        "", ""
    ]).encode('utf-8')

    resp_root = "\r\n".join(base_headers + [
        "ST: upnp:rootdevice",
        f"USN: uuid:{BRIDGE_UUID}::upnp:rootdevice",
        "", ""
    ]).encode('utf-8')

    resp_uuid = "\r\n".join(base_headers + [
        f"ST: uuid:{BRIDGE_UUID}",
        f"USN: uuid:{BRIDGE_UUID}",
        "", ""
    ]).encode('utf-8')

    print(f"[Ready] Listening on Windows host interface for Alexa 'Discover Devices'...", flush=True)
    print("Press Ctrl+C to stop.\n", flush=True)

    while True:
        try:
            data, addr = sock.recvfrom(2048)
            msg = data.decode('utf-8', errors='ignore')
            if 'M-SEARCH' in msg and any(x in msg.lower() for x in ['ssdp:discover', 'ssdp:all', 'rootdevice', 'basic:1', 'device:basic']):
                print(f"[Alexa Bridge] SSDP M-SEARCH received from {addr[0]}:{addr[1]}", flush=True)
                packets = []
                if 'basic:1' in msg.lower():
                    packets.append(resp_basic)
                elif 'rootdevice' in msg.lower():
                    packets.append(resp_root)
                else:
                    packets = [resp_basic, resp_root, resp_uuid]

                for pkt in packets:
                    sock.sendto(pkt, addr)
                time.sleep(0.08)
                for pkt in packets:
                    sock.sendto(pkt, addr)
                print(f"[Alexa Bridge] -> Responded with Hue bridge location to {addr[0]}:{addr[1]}", flush=True)
        except KeyboardInterrupt:
            print("\nShutting down Alexa SSDP listener.")
            break
        except Exception as e:
            print(f"[Alexa Bridge] Warning: {e}")

if __name__ == '__main__':
    main()
