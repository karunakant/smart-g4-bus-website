#!/usr/bin/env python3
"""
SmartBus G4 Database Manager & Search Utility
---------------------------------------------
A layman-friendly CLI tool to inspect, search, and populate SmartBus G4 devices
in the SMART-G4.sqlite3 database.

Usage:
  python scripts/manage_db.py search <keyword>          Search rooms, lights, and fans
  python scripts/manage_db.py list-rooms                List all configured zones/rooms
  python scripts/manage_db.py list-devices [room_name]  List all devices (optionally filter by room)
  python scripts/manage_db.py add-room <room_name>      Add a new room/zone
  python scripts/manage_db.py add-light ...             Add a new light/relay
  python scripts/manage_db.py add-fan ...               Add a new fan
"""

import sqlite3
import argparse
import os
import sys

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'db', 'SMART-G4.sqlite3')

def get_connection():
    if not os.path.exists(DB_PATH):
        print(f"[!] Database file not found at: {DB_PATH}")
        print("[!] Creating a fresh SMART-G4.sqlite3 database with standard schema...")
        init_fresh_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_fresh_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS Zones (
            ZoneID INTEGER PRIMARY KEY AUTOINCREMENT,
            ZoneName TEXT NOT NULL,
            ZoneIconID INTEGER DEFAULT 0,
            SequenceNo INTEGER DEFAULT 0,
            MainZoneID INTEGER DEFAULT 0,
            IconName VARCHAR DEFAULT ''
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS LightInZone (
            ZoneID INT NOT NULL,
            LightID INT NOT NULL,
            LightRemark VARCHAR(20) NOT NULL,
            SubnetID INT DEFAULT 1,
            DeviceID INT DEFAULT 1,
            ChannelNo INT DEFAULT 1,
            CanDim TINYINT DEFAULT 0,
            LightTypeID INT DEFAULT 1,
            SequenceNo INT DEFAULT 0,
            IsAllowCentralControl INTEGER DEFAULT 1,
            status VARCHAR(20) DEFAULT '0',
            ImageIconOff VARCHAR DEFAULT 'null',
            ImageIconOn VARCHAR DEFAULT 'null',
            PRIMARY KEY (ZoneID, LightID)
        )
    ''')
    cur.execute('''
        CREATE TABLE IF NOT EXISTS FanInZone (
            ZoneID INTEGER DEFAULT 1,
            FanID INTEGER PRIMARY KEY AUTOINCREMENT,
            FanName VARCHAR NOT NULL,
            SubnetID CHAR DEFAULT '1',
            DeviceID CHAR DEFAULT '1',
            ChannelNO CHAR DEFAULT '1',
            FanTypeID CHAR DEFAULT '1',
            SequenceNO INTEGER DEFAULT 0,
            Remark VARCHAR DEFAULT '',
            Reserved1 CHAR DEFAULT '0',
            Reserved2 CHAR DEFAULT '0',
            Reserved3 CHAR DEFAULT '0',
            Reserved4 CHAR DEFAULT '0',
            Reserved5 CHAR DEFAULT '0',
            gear VARCHAR DEFAULT '3',
            currentSpeed INTEGER DEFAULT 0
        )
    ''')
    conn.commit()
    conn.close()

def list_rooms():
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT ZoneID, ZoneName FROM Zones ORDER BY ZoneID ASC")
    rooms = cur.fetchall()
    conn.close()

    print("\n" + "=" * 50)
    print(f" {'ID':<6} | {'Room / Zone Name'}")
    print("=" * 50)
    if not rooms:
        print("  No rooms found in database.")
    for r in rooms:
        print(f"  {r['ZoneID']:<6} | {r['ZoneName']}")
    print("=" * 50 + f"\n Total: {len(rooms)} rooms\n")

def list_devices(filter_room=None):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT ZoneID, ZoneName FROM Zones")
    zone_map = {r['ZoneID']: r['ZoneName'] for r in cur.fetchall()}

    cur.execute("SELECT * FROM LightInZone ORDER BY ZoneID, LightID")
    lights = cur.fetchall()

    cur.execute("SELECT * FROM FanInZone ORDER BY ZoneID, FanID")
    fans = cur.fetchall()
    conn.close()

    items = []
    for l in lights:
        room = zone_map.get(l['ZoneID'], f"Zone {l['ZoneID']}")
        if filter_room and filter_room.lower() not in room.lower():
            continue
        dev_type = "Dimmer" if l['CanDim'] == 1 else "Relay"
        name = l['LightRemark'] or f"Light {l['LightID']}"
        items.append({
            'type': dev_type,
            'room': room,
            'name': name.strip(),
            'subnet': l['SubnetID'],
            'device': l['DeviceID'],
            'channel': l['ChannelNo'],
            'id': f"Z{l['ZoneID']}-L{l['LightID']}"
        })

    for f in fans:
        room = zone_map.get(f['ZoneID'], f"Zone {f['ZoneID']}")
        if filter_room and filter_room.lower() not in room.lower():
            continue
        name = f['FanName'] or "Fan"
        items.append({
            'type': 'Fan',
            'room': room,
            'name': name.strip(),
            'subnet': f['SubnetID'],
            'device': f['DeviceID'],
            'channel': f['ChannelNO'],
            'id': f"Z{f['ZoneID']}-F{f['FanID']}"
        })

    print("\n" + "=" * 80)
    print(f" {'Type':<8} | {'Room':<18} | {'Device Name':<22} | {'Address (Sub.Dev.Ch)'} | {'Key'}")
    print("=" * 80)
    if not items:
        print("  No devices matched criteria.")
    for it in items:
        addr = f"{it['subnet']}.{it['device']}.{it['channel']}"
        print(f" {it['type']:<8} | {it['room'][:18]:<18} | {it['name'][:22]:<22} | {addr:<20} | {it['id']}")
    print("=" * 80 + f"\n Total: {len(items)} devices\n")

def search_database(query):
    query_str = query.lower().strip()
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT ZoneID, ZoneName FROM Zones")
    zone_map = {r['ZoneID']: r['ZoneName'] for r in cur.fetchall()}

    cur.execute("SELECT * FROM LightInZone")
    lights = cur.fetchall()

    cur.execute("SELECT * FROM FanInZone")
    fans = cur.fetchall()
    conn.close()

    results = []
    # Search Lights
    for l in lights:
        room = zone_map.get(l['ZoneID'], f"Zone {l['ZoneID']}")
        name = (l['LightRemark'] or f"Light {l['LightID']}").strip()
        addr = f"{l['SubnetID']}.{l['DeviceID']}.{l['ChannelNo']}"
        dev_type = "Dimmer" if l['CanDim'] == 1 else "Relay"

        if (query_str in room.lower() or 
            query_str in name.lower() or 
            query_str in addr or 
            query_str in dev_type.lower()):
            results.append({
                'type': dev_type,
                'room': room,
                'name': name,
                'address': addr,
                'status': 'ON' if l['status'] == '1' else 'OFF'
            })

    # Search Fans
    for f in fans:
        room = zone_map.get(f['ZoneID'], f"Zone {f['ZoneID']}")
        name = (f['FanName'] or "Fan").strip()
        addr = f"{f['SubnetID']}.{f['DeviceID']}.{f['ChannelNO']}"
        if (query_str in room.lower() or 
            query_str in name.lower() or 
            query_str in addr or 
            query_str == 'fan'):
            results.append({
                'type': 'Fan',
                'room': room,
                'name': name,
                'address': addr,
                'status': f"Speed {f['currentSpeed']}" if f['currentSpeed'] else 'OFF'
            })

    print("\n" + "=" * 75)
    print(f" Search Results for: '{query}'")
    print("=" * 75)
    print(f" {'Type':<8} | {'Room':<18} | {'Name':<22} | {'Address':<10} | {'Status'}")
    print("-" * 75)
    if not results:
        print(f"  No devices found matching '{query}'.")
    for r in results:
        print(f" {r['type']:<8} | {r['room'][:18]:<18} | {r['name'][:22]:<22} | {r['address']:<10} | {r['status']}")
    print("=" * 75 + f"\n Total Matches: {len(results)}\n")

def add_room(room_name):
    conn = get_connection()
    cur = conn.cursor()
    cur.execute("SELECT ZoneID FROM Zones WHERE LOWER(ZoneName) = LOWER(?)", (room_name.strip(),))
    existing = cur.fetchone()
    if existing:
        print(f"[!] Room '{room_name}' already exists with ZoneID {existing['ZoneID']}.")
        conn.close()
        return existing['ZoneID']

    cur.execute("INSERT INTO Zones (ZoneName) VALUES (?)", (room_name.strip(),))
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    print(f"[+] Successfully added room '{room_name}' (ZoneID: {new_id})")
    return new_id

def add_light(room_name, light_name, subnet, device, channel, can_dim=False):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT ZoneID FROM Zones WHERE LOWER(ZoneName) = LOWER(?)", (room_name.strip(),))
    zone = cur.fetchone()
    if not zone:
        cur.execute("INSERT INTO Zones (ZoneName) VALUES (?)", (room_name.strip(),))
        zone_id = cur.lastrowid
        print(f"[+] Created new room '{room_name}' (ZoneID: {zone_id})")
    else:
        zone_id = zone['ZoneID']

    cur.execute("SELECT MAX(LightID) FROM LightInZone WHERE ZoneID = ?", (zone_id,))
    max_id = cur.fetchone()[0] or 0
    next_light_id = max_id + 1

    cur.execute('''
        INSERT INTO LightInZone (ZoneID, LightID, LightRemark, SubnetID, DeviceID, ChannelNo, CanDim, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, '0')
    ''', (zone_id, next_light_id, light_name.strip(), int(subnet), int(device), int(channel), 1 if can_dim else 0))

    conn.commit()
    conn.close()

    dev_type = "Dimmer" if can_dim else "Relay"
    print(f"[+] Added {dev_type}: '{light_name}' in '{room_name}' at Subnet:{subnet} Device:{device} Channel:{channel}")
    print("[*] Note: Restart or refresh the server to reload devices into Home Assistant / Alexa.")

def add_fan(room_name, fan_name, subnet, device, channel):
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("SELECT ZoneID FROM Zones WHERE LOWER(ZoneName) = LOWER(?)", (room_name.strip(),))
    zone = cur.fetchone()
    if not zone:
        cur.execute("INSERT INTO Zones (ZoneName) VALUES (?)", (room_name.strip(),))
        zone_id = cur.lastrowid
        print(f"[+] Created new room '{room_name}' (ZoneID: {zone_id})")
    else:
        zone_id = zone['ZoneID']

    cur.execute('''
        INSERT INTO FanInZone (ZoneID, FanName, SubnetID, DeviceID, ChannelNO, gear, currentSpeed)
        VALUES (?, ?, ?, ?, ?, '5', 0)
    ''', (zone_id, fan_name.strip(), str(subnet), str(device), str(channel)))

    conn.commit()
    conn.close()

    print(f"[+] Added Fan: '{fan_name}' in '{room_name}' at Subnet:{subnet} Device:{device} Channel:{channel}")
    print("[*] Note: Restart or refresh the server to reload devices into Home Assistant / Alexa.")

def main():
    parser = argparse.ArgumentParser(description="SmartBus G4 SQLite Database Manager & Search Tool")
    subparsers = parser.add_subparsers(dest="command")

    # search
    search_p = subparsers.add_parser("search", help="Search rooms, lights, fans, or hardware addresses")
    search_p.add_argument("query", help="Keyword to search (e.g. 'Kitchen', 'Spot', '1.47.1')")

    # list-rooms
    subparsers.add_parser("list-rooms", help="List all configured rooms/zones")

    # list-devices
    list_dev_p = subparsers.add_parser("list-devices", help="List all devices")
    list_dev_p.add_argument("--room", help="Filter by room name", default=None)

    # add-room
    add_room_p = subparsers.add_parser("add-room", help="Add a new room")
    add_room_p.add_argument("name", help="Name of the room (e.g. 'Balcony')")

    # add-light
    add_light_p = subparsers.add_parser("add-light", help="Add a new light or relay")
    add_light_p.add_argument("--room", required=True, help="Room name")
    add_light_p.add_argument("--name", required=True, help="Light name (e.g. 'Ceiling Spotlight')")
    add_light_p.add_argument("--subnet", type=int, default=1, help="SmartBus Subnet ID (default: 1)")
    add_light_p.add_argument("--device", type=int, required=True, help="SmartBus Module Device ID (e.g. 47)")
    add_light_p.add_argument("--channel", type=int, required=True, help="Relay/Dimmer Channel Number (1-24)")
    add_light_p.add_argument("--dimmer", action="store_true", help="Set if channel is dimmable (default: relay switch)")

    # add-fan
    add_fan_p = subparsers.add_parser("add-fan", help="Add a new fan")
    add_fan_p.add_argument("--room", required=True, help="Room name")
    add_fan_p.add_argument("--name", required=True, help="Fan name (e.g. 'Master Fan')")
    add_fan_p.add_argument("--subnet", type=int, default=1, help="SmartBus Subnet ID (default: 1)")
    add_fan_p.add_argument("--device", type=int, required=True, help="SmartBus Module Device ID (e.g. 10)")
    add_fan_p.add_argument("--channel", type=int, required=True, help="Fan Channel Number (1-4)")

    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(0)

    args = parser.parse_args()

    if args.command == "search":
        search_database(args.query)
    elif args.command == "list-rooms":
        list_rooms()
    elif args.command == "list-devices":
        list_devices(args.room)
    elif args.command == "add-room":
        add_room(args.name)
    elif args.command == "add-light":
        add_light(args.room, args.name, args.subnet, args.device, args.channel, args.dimmer)
    elif args.command == "add-fan":
        add_fan(args.room, args.name, args.subnet, args.device, args.channel)

if __name__ == '__main__':
    main()
