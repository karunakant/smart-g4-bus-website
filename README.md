# SmartBus G4 Home Automation, Home Assistant & Alexa Controller

An end-to-end Home Automation & Multi-Zone Audio System designed for **SmartBus G4 (HDL Buspro / S-Bus)** protocol hardware, integrated with **Home Assistant (Instant MQTT Auto-Discovery for 87+ Entities)**, **Amazon Alexa (Local Voice Control via Philips Hue Bridge Emulation)**, and **Z-Audio Multi-Zone Controllers (via SmartBus IP Gateway `192.168.0.200`)**, hosted via **Docker Containers**, featuring an ultra-modern glassmorphic Web Dashboard, **SmartBus Subnet Scanner & Setup Manager**, and dynamic zero-hardcoding LAN network resolution.

![Home Assistant](https://img.shields.io/badge/Home_Assistant-MQTT_Auto--Discovery-41bdf5?style=for-the-badge&logo=home-assistant)
![Mosquitto MQTT](https://img.shields.io/badge/Mosquitto_MQTT-Port_1883-660066?style=for-the-badge&logo=eclipse-mosquitto)
![Alexa Voice Ready](https://img.shields.io/badge/Amazon_Alexa-Voice_Control_Ready-ff9900?style=for-the-badge&logo=alexa)
![Docker Ready](https://img.shields.io/badge/Docker-Container_Ready-06b6d4?style=for-the-badge&logo=docker)
![SmartBus G4](https://img.shields.io/badge/SmartBus_G4-UDP_Port_6000-6366f1?style=for-the-badge)
![SmartBus Gateway](https://img.shields.io/badge/SmartBus_Gateway-192.168.0.200-10b981?style=for-the-badge)

---

## 🌟 Key Highlights

- 🏡 **Home Assistant MQTT Auto-Discovery**: Automatically exposes all 87+ SmartBus lights, switches, dimmers, fans, and curtains into Home Assistant (`homeassistant/#`) with clean room-prefixed entity names (e.g., `Kitchen Spot 1`, `Kitchen Fan`) and automatic area assignments with zero manual YAML.
- 🎙️ **Amazon Alexa Local Voice Control**: Zero-cloud Philips Hue bridge emulator responds to local UPnP SSDP multicast (Port 1900 / 80) so all Echo devices can discover and control switches and fans natively.
- 🌐 **Zero Hardcoded IPs**: Dynamically binds to your server's current physical Wi-Fi / Ethernet LAN IP (`HOST_IP=auto`), adapting automatically if DHCP changes your router IP.
- 🐳 **Cross-Platform Docker Stack**: Pre-configured multi-container stack (Node.js engine + Mosquitto MQTT broker) running smoothly on both **Raspberry Pi 4** and **Windows 11**.

---

## 📚 User Manuals & Quick Guides

Comprehensive, step-by-step guides written specifically for layman users:

| Document | Description | Target Platform |
| :--- | :--- | :--- |
| 📖 **[Installation & Operator's Manual](docs/INSTALLATION_MANUAL.md)** | Step-by-step layman guide to install and run the system with Docker, configure Home Assistant MQTT auto-discovery, and set up Amazon Alexa voice control. | **Raspberry Pi 4** & **Windows 11** |
| 🗄️ **[Database Management & Search Manual](docs/DATABASE_MANUAL.md)** | Comprehensive guide explaining the SQLite database architecture (`SMART-G4.sqlite3`), 4 simple ways to populate rooms/devices, and 3 ways to search data. | Cross-platform |
| 🛠️ **[Interactive Database CLI (`manage_db.py`)](scripts/manage_db.py)** | Easy command-line tool for listing rooms, viewing equipment, searching devices, and adding new switches/fans without touching SQL. | Python 3 (CLI) |

---

## 📐 Technical Architecture

```
                    ┌─────────────────────────────────────────┐      ┌─────────────────────────────┐
                    │      Amazon Echo / Alexa Device         │      │       Home Assistant        │
                    │  ("Alexa, turn on Kitchen Spot 1")      │      │  (MQTT Auto-Discovery 87+)  │
                    └────────────────────┬────────────────────┘      └──────────────┬──────────────┘
                                         │ UPnP SSDP Multicast (Port 1900/80)       │ MQTT Port 1883
                                         ▼                                          ▼
                    ┌─────────────────────────────────────────┐      ┌─────────────────────────────┐
                    │      SmartBus Node.js Container         │ ───► │ Mosquitto MQTT Broker       │
                    │  - Dual HTTP: Web (3000) & Alexa (80)   │ ◄─── │ (Port 1883 / WebSockets 9001)│
                    │  - Dynamic Network IP Auto-Detection    │      └─────────────────────────────┘
                    │  - SmartBus Subnet Scanner Engine       │
                    │  - Alexa SSDP / Hue Bridge Emulator     │
                    │  - Home Assistant MQTT Discovery Queue  │
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
| `HOST_IP` | `auto` | Dynamic IPv4 LAN address of host (auto-detected, no hardcoded IPs needed). |
| `UDP_PORT` | `6000` | Standard SmartBus G4 binary datagram UDP port. |
| `GATEWAY_IP` | `192.168.0.200` | LAN IP address of your physical SmartBus G4 IP Gateway. |
| `ZAUDIO_IP` | `192.168.0.200` | LAN IP address of your Z-Audio RSIP Gateway. |
| `MQTT_BROKER_URL` | `mqtt://127.0.0.1:1883` | Connection string to Mosquitto MQTT Broker. |
| `NODE_ENV` | `production` | Node.js execution environment. |

---

## ➕ How to Add Devices & Channels

Devices can be added using **4 different methods**: automatically via the UI Scanner, interactively using the UI setup form, using the official SQLite database / CLI tool, or manually by editing `data/devices.json`.

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

### Method 4: Official Master SQLite Database & CLI Tool (Recommended)

You can manage all your rooms, relays, dimmers, and fans directly in the master database (`db/SMART-G4.sqlite3`) or with the included command-line helper:
- **Drop-in Official Backup**: Simply copy your existing `SMART-G4.sqlite3` from the SmartBus G4 Windows software or Android app directly into the `db/` folder.
- **Visual GUI Editing**: Open `db/SMART-G4.sqlite3` in [DB Browser for SQLite](https://sqlitebrowser.org/) to view and edit `Zones`, `LightInZone`, and `FanInZone`.
- **Interactive CLI Helper**: Use [`scripts/manage_db.py`](scripts/manage_db.py) to add rooms and devices in seconds:
  ```bash
  python scripts/manage_db.py add-room "Balcony"
  python scripts/manage_db.py add-light --room "Balcony" --name "Wall Light" --subnet 1 --device 47 --channel 7
  python scripts/manage_db.py add-fan --room "Balcony" --name "Exhaust Fan" --subnet 1 --device 44 --channel 1
  python scripts/manage_db.py search "Kitchen"
  ```
👉 For complete database schema details, step-by-step screenshots, and SQL search recipes, refer to the **[Database Management & Search Manual](docs/DATABASE_MANUAL.md)**.

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
   - **Broker**: `<smartbus-server-ip>` *(e.g. your Raspberry Pi IP `192.168.0.205` or Windows PC IP `192.168.0.18`)*
   - **Port**: `1883`
   - **Username / Password**: Leave blank (anonymous enabled by default).
4. Click **Submit**. Home Assistant will immediately discover all 87+ SmartBus devices!
5. **Clean Entity Names**: All entities retain their natural room-prefixed names (e.g., `Kitchen Spot 1`, `Kitchen Fan`, `Parents Bedroom Wall Light`, `Hall Main Curtain`) and are automatically grouped into their respective room areas.

#### Method B: Connect SmartBus to your existing Home Assistant Mosquitto Broker
If you already run the Home Assistant Mosquitto MQTT Add-on:
1. Open the **Queue & MQTT Service** tab on the SmartBus web dashboard (or edit `MQTT_BROKER_URL` in `docker-compose.yml`).
2. Set:
   - **Broker URL**: `mqtt://<home-assistant-ip>:1883`
   - **Username / Password**: Your Home Assistant MQTT user credentials.
3. Click **Connect & Save Settings**.
4. Click **Sync with Home Assistant Now**. All entities will broadcast directly into your existing broker.

> [!TIP]
> **Integrating Third-Party Smart Devices (Wipro, Tuya, Smart Life, Sonoff)**:
> If you have wireless smart devices such as Wipro smart plugs, bulbs, or fan switches, connect them directly to Home Assistant using the official **Tuya / Smart Life integration** (or **LocalTuya** for local control). Once integrated, Home Assistant unifies your wired SmartBus G4 installation and wireless Wipro smart devices in a single dashboard, allowing cross-system automations (e.g. turning on a SmartBus wall light when a Wipro motion sensor triggers).

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

> [!TIP]
> For a complete beginner's step-by-step setup guide for both **Raspberry Pi 4** and **Windows 11** (including package installation, Docker setup, firewall configuration, systemd services, and startup boot scripts), see the **[Installation & Operator's Manual](docs/INSTALLATION_MANUAL.md)**.

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
