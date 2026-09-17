# SmartBus G4 Home Automation & Z-Audio Controller

An end-to-end Home Automation & Multi-Zone Audio System designed for **SmartBus G4 (HDL Buspro / S-Bus)** protocol hardware, integrated with **Z-Audio Multi-Zone Controllers (via SmartBus IP Gateway `192.168.0.200`)**, hosted via **Docker Containers**, featuring an ultra-modern glassmorphic Web Dashboard, **SmartBus Subnet Scanner & Setup Manager**, **Nginx Reverse Proxy**, and **Amazon Alexa Local Voice Control**.

![SmartBus Scanner](https://img.shields.io/badge/SmartBus_Scanner-Subnet_1--255-10b981?style=for-the-badge)
![Alexa Voice Ready](https://img.shields.io/badge/Amazon_Alexa-Voice_Control_Ready-ff9900?style=for-the-badge&logo=alexa)
![Docker Ready](https://img.shields.io/badge/Docker-Container_Ready-06b6d4?style=for-the-badge&logo=docker)
![Nginx Proxy](https://img.shields.io/badge/Nginx_Proxy-Port_80-009639?style=for-the-badge&logo=nginx)
![SmartBus G4](https://img.shields.io/badge/SmartBus_G4-UDP_Port_6000-6366f1?style=for-the-badge)
![SmartBus Gateway](https://img.shields.io/badge/SmartBus_Gateway-192.168.0.200-10b981?style=for-the-badge)

---

## 📐 Technical Architecture

```
                    ┌─────────────────────────────────────────┐
                    │      Amazon Echo / Alexa Device         │
                    │  ("Alexa, turn on Kitchen Spot 1")      │
                    └────────────────────┬────────────────────┘
                                         │ Local UPnP SSDP Multicast (Port 1900)
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │        Nginx Reverse Proxy (Port 80)    │
                    │     (Routes /description.xml & /api/*)  │
                    └────────────────────┬────────────────────┘
                                         │ Reverse Proxy / HTTP (Port 6080)
                                         ▼
                    ┌─────────────────────────────────────────┐      ┌─────────────────────────────┐
                    │      SmartBus Node.js Container         │ ───► │ Mosquitto MQTT Container    │
                    │  - Network Mode: Host (UDP Broadcast)   │ ◄─── │ (Port 1883 / WebSockets 9001)│
                    │  - SmartBus Subnet Scanner Engine       │      └─────────────────────────────┘
                    │  - Alexa SSDP / Hue Bridge Emulator     │
                    │  - Priority Command Queue Engine        │
                    │  - SmartBus & Z-Audio UDP Driver        │
                    └────────────────────┬────────────────────┘
                                         │ Binary UDP Datagram (Port 6000)
                                         ▼
                    ┌────────────────────┴────────────────────┐
                    │                                         │
                    ▼                                         ▼
        ┌───────────────────────┐                 ┌───────────────────────┐
        │  SmartBus IP Gateway  │ ────── S-Bus ──► │ SmartBus G4 & Z-Audio │
        │   (192.168.0.200)     │                 │ (Relays, Dimmers, AC) │
        └───────────────────────┘                 └───────────────────────┘
```

---

## ⚙️ System Settings & Environment Variables

All core backend configuration settings can be customized in `docker-compose.yml` via container environment variables:

| Environment Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `6080` (or `3000`) | Internal TCP port for Express REST API & WebSockets server. |
| `EXTERNAL_PORT` | `80` | External HTTP port advertised in SSDP UPnP headers for Alexa Echo discovery. |
| `HOST_IP` | `192.168.0.205` | Static IPv4 LAN address of your Raspberry Pi / host server. |
| `UDP_PORT` | `6000` | Standard SmartBus G4 binary datagram UDP port. |
| `GATEWAY_IP` | `192.168.0.200` | LAN IP address of your physical SmartBus G4 IP Gateway. |
| `ZAUDIO_IP` | `192.168.0.200` | LAN IP address of your Z-Audio RSIP Gateway. |
| `MQTT_BROKER_URL` | `mqtt://127.0.0.1:1883` | Connection string to Mosquitto MQTT Broker. |
| `NODE_ENV` | `production` | Node.js execution environment. |

---

## ➕ How to Add Devices & Channels

Devices can be added using **3 different methods**: automatically via the UI Scanner, interactively using the UI setup form, or manually by editing `data/devices.json`.

---

### Method 1: Automatic Discovery via Subnet Scanner (UI)

1. Open your browser and navigate to `http://<server-ip>:6080` (or `http://<server-ip>/`).
2. Click on the **Subnet Scanner** tab in the top navigation bar.
3. Select your target **Subnet ID** (default: `1`).
4. Click **Start Subnet Scan**.
5. The scanner broadcasts device search frames (`Opcode 0x000E`) over UDP Port 6000 across Subnet 1–255. All online SmartBus relay modules, dimmers, fan controllers, and Z-Audio units automatically register in the UI.

---

### Method 2: Interactive Add Equipment Form (UI)

1. Open the Web Dashboard.
2. Click the **+ Add Equipment** button on the top right of the Equipment panel.
3. Fill out the fields:
   - **Name**: Name of the light/switch (e.g., `Spot 1`, `Chandelier`, `Ceiling Fan`).
   - **Room**: Room location (e.g., `Kitchen`, `Parents Bedroom`, `Passage`, `Guest Bathroom`).
   - **Equipment Type**: Select `Relay` (On/Off), `Dimmer` (0–100%), `3-Speed Fan`, or `RGB Light`.
   - **Subnet ID**: SmartBus Subnet (default: `1`).
   - **Device ID**: Hardware Device ID (e.g., `47`, `50`, `60`, `120`).
   - **Channel**: Output Relay/Dimmer Channel number (e.g., `1` to `24`).
4. Click **Save Equipment**. The device is saved directly to persistent storage (`data/devices.json`) and synced to the runtime SQLite database (`db/SMART-G4.sqlite3`).

---

### Method 3: Manual JSON File Configuration (`data/devices.json`)

You can edit `data/devices.json` directly using a text editor.

#### `data/devices.json` Example Entry:

```json
{
  "devices": {
    "dev_z3_l1": {
      "id": "dev_z3_l1",
      "name": "Spot 1",
      "room": "Kitchen",
      "type": "relay",
      "subnet": 1,
      "deviceId": 47,
      "channel": 14,
      "power": true,
      "level": 100
    },
    "dev_z5_l3": {
      "id": "dev_z5_l3",
      "name": "Ceiling Fan",
      "room": "Shipra Bedroom",
      "type": "fan",
      "subnet": 1,
      "deviceId": 60,
      "channel": 7,
      "power": false,
      "level": 0,
      "speedName": "Off"
    },
    "dev_z4_l3": {
      "id": "dev_z4_l3",
      "name": "LED Accent",
      "room": "Parents Bedroom",
      "type": "rgb",
      "subnet": 1,
      "deviceId": 50,
      "channel": 7,
      "power": true,
      "level": 100,
      "color": "#6366f1"
    }
  }
}
```

#### JSON Field Schema:

- `id` *(String, required)*: Unique string identifier (e.g., `dev_room_ch1`).
- `name` *(String, required)*: Descriptive label for the equipment.
- `room` *(String, required)*: Room name. *Note: Alexa automatically prefixes room names to ensure unique voice targeting.*
- `type` *(String, required)*: Supported values:
  - `"relay"`: Standard on/off switch channel.
  - `"dimmer"`: 0–100% brightness control.
  - `"fan"`: 3-speed ceiling fan (Off, Low, Medium, High, Turbo).
  - `"rgb"`: RGB color light channel.
- `subnet` *(Integer, required)*: S-Bus Subnet number (`1`–`254`).
- `deviceId` *(Integer, required)*: S-Bus Hardware Device ID (`1`–`254`).
- `channel` *(Integer, required)*: Module Channel index (`1`–`24`).
- `power` *(Boolean)*: Initial power state (`true`/`false`).
- `level` *(Integer)*: Brightness level (`0`–`100`) or fan speed level (`0`–`5`).

---

## 🎙️ Amazon Alexa Local Voice Control

This application includes a built-in **SSDP/UPnP Local Bridge** (`lib/alexa-bridge.js`) that emulates a Philips Hue Bridge.

### Setup Instructions for Alexa:

1. **Connect to the same Wi-Fi**: Ensure your physical Amazon Echo Dot and your Raspberry Pi are connected to the same subnet (`192.168.0.x`).
2. **Network Mode**: Ensure `network_mode: host` is enabled in `docker-compose.yml` so UDP multicast packets (`239.255.255.250:1900`) reach the container.
3. **Discover Devices**:
   - Speak directly to your Echo Dot:
     > **"Alexa, discover devices"**
   - Or open the Alexa App ➔ **Devices** ➔ **+** ➔ **Add Device** ➔ **Light** ➔ **Other** ➔ **Discover Devices**.

### Example Voice Commands:

- *"Alexa, turn on Kitchen Spot 1"*
- *"Alexa, set Shipra Bedroom Fan to High"*
- *"Alexa, set Parents Bedroom LED Accent to 50%"*
- *"Alexa, turn off Guest Bathroom Geyser"*
- *"Alexa, turn on Z-Audio Living Room"*

---

## 🏢 Multi-Site Deployment Guide

You can run this setup across **multiple physical locations** (e.g., Home 1 & Home 2):

1. Deploy one Raspberry Pi per location.
2. In each site's `docker-compose.yml`, configure the site's local IP address and gateway:
   - **Site 1**: `HOST_IP=192.168.0.205`, `GATEWAY_IP=192.168.0.200`
   - **Site 2**: `HOST_IP=192.168.1.205`, `GATEWAY_IP=192.168.1.200`
3. Echo Dots at Site 1 will discover Site 1 devices; Echo Dots at Site 2 will discover Site 2 devices. All devices appear neatly organized in your single Amazon Alexa phone app!

---

## 🚀 Quick Start with Docker

### 1. Build and Start Containers:
```bash
docker compose up -d --build
```

### 2. View Realtime Logs:
```bash
docker compose logs -f smartbusg4-node
```

### 3. Access Dashboard:
- Web Dashboard: `http://<raspberry-pi-ip>:6080` (or `http://<raspberry-pi-ip>/` if Nginx proxy is active)
- REST API Status: `http://<raspberry-pi-ip>:6080/api/status`
- Alexa UPnP Description: `http://<raspberry-pi-ip>:6080/description.xml`
