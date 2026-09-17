import sqlite3
import json
import os

db_path = os.path.join(os.path.dirname(__file__), '..', 'db', 'SMART-G4.sqlite3')
output_json_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'devices.json')

if not os.path.exists(db_path):
    print(f"Error: Database file not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# 1. Fetch Zones
cur.execute("SELECT * FROM Zones")
zones = {r['ZoneID']: r['ZoneName'] for r in cur.fetchall()}

# 2. Fetch Lights & Sockets
cur.execute("SELECT * FROM LightInZone")
lights_rows = cur.fetchall()

devices = {}
for l in lights_rows:
    room_name = zones.get(l['ZoneID'], f"Zone {l['ZoneID']}")
    light_name = (l['LightRemark'] or f"Light {l['LightID']}").strip()
    if not light_name:
        light_name = f"Light {l['LightID']}"

    device_key = f"dev_z{l['ZoneID']}_l{l['LightID']}"

    # Determine type
    dev_type = 'dimmer' if l['CanDim'] == 1 else 'relay'
    name_lower = light_name.lower()
    if 'rgb' in name_lower or 'led' in name_lower or 'blue' in name_lower:
        dev_type = 'rgb'

    item = {
        'id': device_key,
        'name': light_name,
        'room': room_name,
        'type': dev_type,
        'subnet': int(l['SubnetID']),
        'deviceId': int(l['DeviceID']),
        'channel': int(l['ChannelNo']),
        'power': l['status'] == '1',
        'level': 100 if l['status'] == '1' else 0
    }
    if dev_type == 'rgb':
        item['color'] = '#6366f1'

    devices[device_key] = item

# 3. Fetch Fans
cur.execute("SELECT * FROM FanInZone")
fan_rows = cur.fetchall()

speed_names = ['Off', 'Low', 'Medium', 'Medium-High', 'High', 'Turbo']

for f in fan_rows:
    room_name = zones.get(f['ZoneID'], f"Zone {f['ZoneID']}")
    fan_name = (f['FanName'] or 'Fan').strip()
    if fan_name.lower() == 'fan':
        fan_name = f"{room_name} Fan"

    device_key = f"fan_z{f['ZoneID']}_f{f['FanID']}"
    cur_speed = int(f['currentSpeed']) if f['currentSpeed'] is not None else 0

    devices[device_key] = {
        'id': device_key,
        'name': fan_name,
        'room': room_name,
        'type': 'fan',
        'subnet': int(f['SubnetID']),
        'deviceId': int(f['DeviceID']),
        'channel': int(f['ChannelNO']),
        'power': cur_speed > 0,
        'level': cur_speed,
        'speedName': speed_names[cur_speed] if cur_speed < len(speed_names) else 'High'
    }

# 4. Fetch HVAC
hvac = {
  'hvac_hall': {
    'id': 'hvac_hall',
    'name': 'Hall Air Conditioner',
    'room': 'Hall',
    'subnet': 1,
    'deviceId': 5,
    'channel': 1,
    'power': True,
    'targetTemp': 23,
    'currentTemp': 24.5,
    'mode': 'cool',
    'fanSpeed': 'auto'
  },
  'hvac_parents': {
    'id': 'hvac_parents',
    'name': 'Parents Bedroom AC',
    'room': 'Parents Bedroom',
    'subnet': 1,
    'deviceId': 5,
    'channel': 2,
    'power': False,
    'targetTemp': 22,
    'currentTemp': 25.0,
    'mode': 'cool',
    'fanSpeed': 'low'
  },
  'hvac_shipra': {
    'id': 'hvac_shipra',
    'name': 'Shipra Bedroom AC',
    'room': 'Shipra Bedroom',
    'subnet': 1,
    'deviceId': 5,
    'channel': 3,
    'power': False,
    'targetTemp': 23,
    'currentTemp': 24.0,
    'mode': 'cool',
    'fanSpeed': 'medium'
  },
  'hvac_tanay': {
    'id': 'hvac_tanay',
    'name': 'Tanay Bedroom AC',
    'room': 'Tanay Bedroom',
    'subnet': 1,
    'deviceId': 5,
    'channel': 4,
    'power': False,
    'targetTemp': 22,
    'currentTemp': 24.8,
    'mode': 'cool',
    'fanSpeed': 'low'
  }
}

# 5. Curtains
curtains = {
  'curtain_hall_open': {
    'id': 'curtain_hall_open',
    'name': 'Hall Main Curtain',
    'room': 'Hall',
    'subnet': 1,
    'deviceId': 47,
    'channel': 18,
    'position': 100,
    'state': 'idle'
  },
  'curtain_dinning_open': {
    'id': 'curtain_dinning_open',
    'name': 'Dining Area Curtain',
    'room': 'Hall',
    'subnet': 1,
    'deviceId': 47,
    'channel': 20,
    'position': 100,
    'state': 'idle'
  }
}

result_data = {
    'devices': devices,
    'hvac': hvac,
    'curtains': curtains,
    'convertedFromSqlite': True
}

data_dir = os.path.dirname(output_json_path)
if not os.path.exists(data_dir):
    os.makedirs(data_dir, exist_ok=True)

with open(output_json_path, 'w', encoding='utf-8') as f:
    json.dump(result_data, f, indent=2)

print(f"Successfully converted {len(devices)} devices/switches from SMART-G4.sqlite3 to {output_json_path}")
