import sqlite3
import json
import os

db_path = os.path.join(os.path.dirname(__file__), '..', 'db', 'SMART-G4.sqlite3')
runtime_sqlite = os.path.join(os.path.dirname(__file__), '..', 'data', 'smartbus_runtime.sqlite3')
json_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'devices.json')

def sync_to_sqlite():
    if not os.path.exists(json_path):
        return

    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    devices = data.get('devices', {})

    # Create/update runtime SQLite DB
    data_dir = os.path.dirname(runtime_sqlite)
    os.makedirs(data_dir, exist_ok=True)

    conn = sqlite3.connect(runtime_sqlite)
    cur = conn.cursor()

    cur.execute('''
        CREATE TABLE IF NOT EXISTS RuntimeDevices (
            id TEXT PRIMARY KEY,
            name TEXT,
            room TEXT,
            type TEXT,
            subnet INTEGER,
            deviceId INTEGER,
            channel INTEGER,
            power INTEGER,
            level INTEGER,
            speedName TEXT,
            updatedAt TEXT
        )
    ''')

    for dev_id, dev in devices.items():
        cur.execute('''
            INSERT OR REPLACE INTO RuntimeDevices 
            (id, name, room, type, subnet, deviceId, channel, power, level, speedName, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ''', (
            dev.get('id'),
            dev.get('name'),
            dev.get('room'),
            dev.get('type'),
            dev.get('subnet', 1),
            dev.get('deviceId', 10),
            dev.get('channel', 1),
            1 if dev.get('power') else 0,
            dev.get('level', 0),
            dev.get('speedName', '')
        ))

    conn.commit()
    conn.close()
    print(f"[SQLiteManager] Synchronized {len(devices)} devices into {runtime_sqlite}")

if __name__ == '__main__':
    sync_to_sqlite()
