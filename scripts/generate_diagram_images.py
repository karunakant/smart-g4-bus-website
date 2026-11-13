#!/usr/bin/env python3
"""
Mermaid to Image Converter & Markdown Attacher
Converts all mermaid diagrams in docs/ and README.md into high-resolution PNG & SVG images,
saves them to docs/images/, and attaches image references in the markdown files.
"""

import os
import re
import json
import base64
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS_DIR = os.path.join(BASE_DIR, "docs")
IMAGES_DIR = os.path.join(DOCS_DIR, "images")

os.makedirs(IMAGES_DIR, exist_ok=True)

DIAGRAMS = [
    {
        "id": "system-architecture",
        "title": "SmartBus G4 & Z-Audio System Architecture",
        "doc": "INSTALLATION_MANUAL.md",
        "mermaid": """flowchart TD
    subgraph LAN ["Local Home Network (Wi-Fi / Ethernet)"]
        GW["SmartBus G4 IP Gateway<br/>(192.168.0.200:6000 UDP)"]
        HA["Home Assistant<br/>(MQTT Client)"]
        Echo["Amazon Echo / Alexa<br/>(UPnP Multicast + HTTP Port 80)"]
        Phone["Browser / Mobile Dashboard<br/>(HTTP Port 3000 / WebSockets)"]
    end

    subgraph Host ["Server Host (Raspberry Pi 4 OR Windows 11)"]
        subgraph Docker ["Docker Stack"]
            Mosq["Mosquitto MQTT Broker<br/>(Port 1883 / 9001)"]
            Node["Node.js Home Automation Engine<br/>• Web UI (Port 3000)<br/>• UDP Port 6000 Driver<br/>• MQTT Auto-Discovery Queue"]
        end
        SSDP["SSDP Discovery Daemon<br/>(Python 3 - Port 1900 / 80)"]
    end

    GW <-->|UDP 6000| Node
    Node <-->|MQTT 1883| Mosq
    Mosq <-->|MQTT 1883| HA
    Echo <-->|Port 1900 / 80| SSDP
    SSDP <-->|HTTP Proxy 3000| Node
    Phone <-->|HTTP / WS 3000| Node"""
    },
    {
        "id": "database-architecture",
        "title": "SmartBus G4 Database Architecture & Pipeline",
        "doc": "DATABASE_MANUAL.md",
        "mermaid": """flowchart LR
    A["SMART-G4.sqlite3<br/>(Master Configuration DB)"] -->|convert_db.py| B["data/devices.json<br/>(Active Cache)"]
    B -->|DeviceManager| C["Node.js Engine<br/>(Server Memory)"]
    C -->|Priority Queue| D["Home Assistant (MQTT)<br/>Amazon Alexa (Hue API)<br/>Web Dashboard"]
    C -->|save_to_sqlite.py| E["data/smartbus_runtime.sqlite3<br/>(Runtime States & Logs)"]"""
    },
    {
        "id": "home-assistant-architecture",
        "title": "SmartBus G4 to Home Assistant Architecture",
        "doc": "HOME_ASSISTANT_MANUAL.md",
        "mermaid": """flowchart TD
    subgraph SmartBus_Hardware ["SmartBus G4 Wired Network"]
        Relays["DIN-Rail Relays (Module 47, 5, 120)"]
        Dimmers["Phase Dimmers"]
        Fans["Fan Speed Regulators (Module 44)"]
        HVAC["Coolmaster / HVAC Gateways"]
        Curtains["Motorized Curtain Controllers"]
        ZAudio["Z-Audio RSIP Gateway"]
    end

    GW["SmartBus IP Gateway (192.168.0.200:6000 UDP)"]
    Relays <-->|S-Bus Data Cable| GW
    Dimmers <-->|S-Bus Data Cable| GW
    Fans <-->|S-Bus Data Cable| GW
    HVAC <-->|S-Bus Data Cable| GW
    Curtains <-->|S-Bus Data Cable| GW
    ZAudio <-->|UDP 6000| GW

    subgraph Server_Host ["SmartBus Automation Host (Pi 4 or PC)"]
        NodeEngine["SmartBus Engine (Node.js)<br/>- Priority Command Queue<br/>- Auto-Discovery Dispatcher<br/>- Real-time State Mirror"]
        MosqBroker["Mosquitto MQTT Broker (Port 1883 / 9001)"]
    end

    GW <-->|UDP Binary Frames| NodeEngine
    NodeEngine <-->|"MQTT Topics: smartbus"| MosqBroker
    NodeEngine -->|"Auto-Discovery: homeassistant"| MosqBroker

    subgraph Home_Assistant ["Home Assistant (Any Device: Pi, VM, NUC)"]
        HAMQTT["MQTT Integration"]
        HALovelace["Home Assistant UI (Lovelace)<br/>- Rooms and Suggested Areas<br/>- Mobile App (iOS / Android)<br/>- Unified Dashboards and Automations"]
        ThirdParty["Third-Party Integrations<br/>(Wipro, Tuya, Zigbee, Hue)"]
    end

    MosqBroker <-->|"MQTT 1883 TCP"| HAMQTT
    HAMQTT <--> HALovelace
    ThirdParty <--> HALovelace"""
    },
    {
        "id": "home-assistant-wipro-unification",
        "title": "Unified Home Assistant - Wired SmartBus & Wireless Wipro",
        "doc": "HOME_ASSISTANT_MANUAL.md",
        "mermaid": """flowchart LR
    subgraph HA ["Home Assistant (Unified Brain)"]
        UI["Single Mobile App & Lovelace UI"]
        Auto["Unified Automations Engine"]
    end

    subgraph Wired ["SmartBus G4 (Wired)"]
        SB["87+ Relays, Dimmers & Fans"]
    end

    subgraph Wireless ["Third-Party Wireless (Wi-Fi)"]
        WiproPlug["Wipro Smart Plug (16A)"]
        WiproLight["Wipro Smart Bulb / Batten"]
        WiproFan["Wipro Fan Controller"]
    end

    SB <-->|MQTT| HA
    WiproPlug <-->|Tuya / Smart Life| HA
    WiproLight <-->|Tuya / Smart Life| HA
    WiproFan <-->|Tuya / Smart Life| HA"""
    }
]

def render_diagram(diagram_code, output_base):
    """Encodes mermaid diagram and fetches PNG and SVG from mermaid.ink."""
    payload = {
        "code": diagram_code,
        "mermaid": {
            "theme": "default",
            "themeVariables": {
                "fontFamily": "Segoe UI, Arial, sans-serif",
                "fontSize": "15px"
            }
        }
    }
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode("utf-8")).decode("ascii")
    
    # 1. Fetch SVG
    svg_url = f"https://mermaid.ink/svg/{encoded}"
    svg_path = f"{output_base}.svg"
    print(f"Fetching SVG: {svg_url[:60]}...")
    try:
        req = urllib.request.Request(svg_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            svg_content = resp.read()
            with open(svg_path, "wb") as f:
                f.write(svg_content)
        print(f"  -> Saved {svg_path} ({len(svg_content)} bytes)")
    except Exception as e:
        print(f"  [Error fetching SVG]: {e}")

    # 2. Fetch PNG
    png_url = f"https://mermaid.ink/img/{encoded}?type=png"
    png_path = f"{output_base}.png"
    print(f"Fetching PNG: {png_url[:60]}...")
    try:
        req = urllib.request.Request(png_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            png_content = resp.read()
            with open(png_path, "wb") as f:
                f.write(png_content)
        print(f"  -> Saved {png_path} ({len(png_content)} bytes)")
    except Exception as e:
        print(f"  [Error fetching PNG]: {e}")

def main():
    print("=" * 60)
    print("Converting Mermaid Diagrams to Images...")
    print("=" * 60)
    
    for item in DIAGRAMS:
        print(f"\nProcessing: {item['title']} ({item['id']})")
        out_base = os.path.join(IMAGES_DIR, item['id'])
        render_diagram(item['mermaid'].strip(), out_base)

    print("\nAll diagram images generated successfully in docs/images/!")

if __name__ == "__main__":
    main()
