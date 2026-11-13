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
                    ┌─────────────────────────────────────────┐      ┌─────────────────────────────┐
                    │      SmartBus Node.js Container         │ ───► │ Mosquitto MQTT Container    │
                    │  - Dual HTTP: Web (3000) & Alexa (80)   │ ◄─── │ (Port 1883 / WebSockets 9001)│
                    │  - Network Mode: Host (UDP Broadcast)   │      └─────────────────────────────┘
                    │  - SmartBus Subnet Scanner Engine       │
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

### Key Technical Architecture:
- **Port 80 Requirement**: Amazon Echo firmware strictly expects Philips Hue bridges on HTTP port 80. The server automatically launches a dedicated Port 80 listener alongside the web dashboard port (`3000`/`6080`).
- **UPnP Multicast**: Listens on `239.255.255.250:1900` for Echo `M-SEARCH` discovery packets and broadcasts compliant SSDP headers.
- **Sequential Integer Device Mapping**: Exposes all 87+ equipment channels using Hue-compliant sequential numeric IDs (`"1"`, `"2"`, ...) mapped to the underlying SmartBus hardware IDs.
- **Priority Queue Dispatch**: Incoming voice control calls are queued into `mqttQueueService` with `HIGH` priority, translating state updates directly into SmartBus G4 binary datagrams (`Opcode 0x0031`) and transmitting to the IP gateway (`192.168.0.200`).

### Setup Instructions for Alexa:

1. **Connect to the same Wi-Fi**: Ensure your physical Amazon Echo device and your server are connected to the same local Wi-Fi / subnet (e.g., `192.168.0.x`).
2. **Network Mode**: When using Docker, ensure `network_mode: host` is enabled in `docker-compose.yml` so UDP multicast packets (`239.255.255.250:1900`) and port 80 reach the container.
3. **Discover Devices**:
   - Speak directly to your Echo device:
     > **"Alexa, discover devices"**
   - Or open the Alexa App ➔ **Devices** ➔ **+** ➔ **Add Device** ➔ **Light** ➔ **Other** ➔ **Discover Devices**.
4. **Test & Verify**: Open the **Alexa Voice Control** tab on your web dashboard to see the live bridge diagnostics, verify exposed devices, and test commands with the interactive Voice Command Simulator.

### Example Voice Commands:

- *"Alexa, turn on Kitchen Spot 1"*
- *"Alexa, turn off Kitchen Spot 1"*
- *"Alexa, set Kitchen Spot 1 to 50%"*
- *"Alexa, turn on Master Bedroom Fan"*
- *"Alexa, turn on Z-Audio Main Living Room"*
- *"Alexa, set Z-Audio Main Living Room to 40%"*

### Troubleshooting:
- **Port 80 Permission on Linux**: On Linux/Raspberry Pi without Docker, Node must be allowed to bind port 80. Run:
  ```bash
  sudo setcap 'cap_net_bind_service=+ep' $(which node)
  ```
  Or redirect port 80 to port 3000:
  ```bash
  sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 3000
  ```
- **Echo Subnet Isolation**: Ensure client isolation is turned OFF on your Wi-Fi router so Echo devices can send multicast frames to other LAN devices.

---

## 🏡 Home Assistant MQTT Integration

This application includes seamless **Home Assistant MQTT Auto-Discovery** (`homeassistant/#`). All 90+ SmartBus G4 devices instantly appear in your Home Assistant dashboard with zero manual YAML required!

### Auto-Discovered Entity Types:
- **Lights** (`light.*`): SmartBus dimmers & RGB accent lights with on/off, 0–100% brightness sliders, and RGB color wheel.
- **Switches** (`switch.*`): SmartBus relays (kitchen appliances, geysers, sockets, washing machines, dry areas).
- **Fans** (`fan.*`): SmartBus 3-speed ceiling fans with on/off and step speed percentage controls (Low, Medium, Medium-High, High, Turbo).
- **Climate / HVAC** (`climate.*`): Air conditioning thermostats with mode selection (`cool`, `heat`, `fan_only`, `dry`, `off`), target temperature setpoint (16–30°C), current room temperature sensor, and fan speeds (`low`, `medium`, `high`, `auto`).
- **Covers / Curtains** (`cover.*`): Motorized curtains with Open, Close, Stop, and 0–100% position slider.
- **Scenes** (`scene.*`): One-touch SmartBus macros.
- **Device Grouping & Suggested Areas**: Entities are grouped under their physical hardware module (e.g. *HDL 24-Channel Relay Sub:1 Dev:47*) and automatically assigned to their respective Home Assistant Rooms/Areas (*Kitchen*, *Parents Bedroom*, *Shipra Bedroom*, *Tanay Bedroom*, *Hall*).
- **Live Availability (LWT)**: Shows entities as *Available* when the server is online and *Unavailable* if offline via `smartbus/status`.

### How to Connect Home Assistant:

#### Method A: Connect Home Assistant to the Built-in Mosquitto Broker (Easiest)
1. In Home Assistant, navigate to **Settings** ➔ **Devices & Services** ➔ **+ Add Integration**.
2. Search for **MQTT** and select it.
3. Configure connection:
   - **Broker**: `<smartbus-server-ip>` (e.g. `192.168.0.24` or Raspberry Pi IP)
   - **Port**: `1883`
   - **Username / Password**: Leave blank (anonymous enabled by default).
4. Click **Submit**. Home Assistant will immediately discover all 90+ SmartBus devices!

#### Method B: Connect SmartBus to your existing Home Assistant Mosquitto Broker
If you already run the Home Assistant Mosquitto MQTT Add-on:
1. Open the **Queue & MQTT Service** tab on the SmartBus web dashboard (or edit `MQTT_BROKER_URL` in `docker-compose.yml`).
2. Set:
   - **Broker URL**: `mqtt://<home-assistant-ip>:1883`
   - **Username / Password**: Your Home Assistant MQTT user credentials.
3. Click **Connect & Save Settings**.
4. Click **Sync with Home Assistant Now**. All entities will broadcast directly into your existing broker.

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

### 1. Start Containers:
```bash
docker compose up -d
```

### 2. Alexa Discovery (Windows vs Linux):
- **Windows Host**:
  Simply double-click `start-alexa-ssdp.bat` (or run `python scripts/alexa-ssdp-discovery.py`). This runs directly on your Windows host to handle UPnP SSDP multicast on port 1900 without conflicts with Windows' native `SSDPSRV` service, directing your Amazon Echo to the container's port 80.
- **Linux / Raspberry Pi**:
  In `docker-compose.yml`, you can enable `network_mode: host` directly for native Layer 2 multicast without any helper script.

### 3. Trigger Discovery:
- Say: *"Alexa, discover devices"* or open the Alexa App ➔ **Devices** ➔ **+ Add Device** ➔ **Philips Hue Bridge** / **Other**.
- All 87 SmartBus equipment devices and Z-Audio zones will be discovered!

### 4. Access Dashboard:
- Web Dashboard: `http://localhost:3000` (or `http://<server-ip>:3000`)
- REST API Status: `http://<server-ip>:3000/api/status`
- Alexa UPnP Description: `http://<server-ip>/description.xml` (Port 80)
- Alexa Bridge Status: `http://<server-ip>:3000/api/alexa/status`
