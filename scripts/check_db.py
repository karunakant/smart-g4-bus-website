#!/usr/bin/env python3
import sqlite3
import os
import sys

db_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'smartbus_runtime.sqlite3')

if not os.path.exists(db_path):
    print(f"[!] Runtime database not found at {db_path}")
    print("[!] Run the application first to generate runtime state database.")
    sys.exit(1)

conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("SELECT COUNT(*) FROM RuntimeDevices")
total = cur.fetchone()[0]

print("=======================================================")
print(" SmartBus Runtime SQLite Database Status")
print("=======================================================")
print(f" Database Path  : {os.path.abspath(db_path)}")
print(f" Total Switches : {total} equipment devices saved")
print("=======================================================")
print("\nMost Recently Updated Devices (Top 10):")
print("-" * 65)
print(f"{'ID':<22} | {'Name':<22} | {'State':<8} | {'Updated At'}")
print("-" * 65)

cur.execute("SELECT id, name, power, level, speedName, type, updatedAt FROM RuntimeDevices ORDER BY updatedAt DESC LIMIT 10")
rows = cur.fetchall()

for r in rows:
    dev_id, name, power, level, speed_name, dev_type, updated_at = r
    state_str = f"ON ({level}%)" if power else "OFF"
    if dev_type == 'fan':
        state_str = f"FAN ({speed_name})" if power else "FAN (Off)"
    print(f"{dev_id:<22} | {name[:22]:<22} | {state_str:<8} | {updated_at}")

print("-" * 65)
