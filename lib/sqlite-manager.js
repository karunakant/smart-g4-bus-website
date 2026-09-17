/**
 * SQLite Database Manager for SmartBus G4 & Z-Audio Home Automation
 *
 * Handles reading from original db/SMART-G4.sqlite3 and persisting runtime device
 * updates into data/smartbus_runtime.sqlite3.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SQLITE_FILE = path.join(__dirname, '..', 'db', 'SMART-G4.sqlite3');
const CONVERT_SCRIPT = path.join(__dirname, 'convert_db.py');
const SAVE_SCRIPT = path.join(__dirname, 'save_to_sqlite.py');

class SQLiteManager {
  constructor() {
    this.sqlitePath = SQLITE_FILE;
    this.pythonCmd = this.detectPython();
  }

  /**
   * Detect python3 or python executable
   */
  detectPython() {
    try {
      execSync('python3 --version', { stdio: 'ignore' });
      return 'python3';
    } catch (e) {
      try {
        execSync('python --version', { stdio: 'ignore' });
        return 'python';
      } catch (err) {
        return null;
      }
    }
  }

  /**
   * Reads and imports devices from SMART-G4.sqlite3
   */
  syncFromSQLite() {
    if (!this.pythonCmd) {
      console.warn('[SQLiteManager] Python binary not found in environment, using cached devices JSON state.');
      return false;
    }

    if (fs.existsSync(this.sqlitePath)) {
      try {
        console.log(`[SQLiteManager] Reading initial devices from ${this.sqlitePath}...`);
        execSync(`${this.pythonCmd} "${CONVERT_SCRIPT}"`, { stdio: 'pipe' });
        console.log('[SQLiteManager] Database import completed successfully.');
        return true;
      } catch (e) {
        console.warn('[SQLiteManager] SQLite import note:', e.message);
      }
    }
    return false;
  }

  /**
   * Persists device changes back to runtime SQLite DB
   */
  saveToSQLite() {
    if (!this.pythonCmd) return;
    try {
      execSync(`${this.pythonCmd} "${SAVE_SCRIPT}"`, { stdio: 'pipe' });
    } catch (e) {
      console.warn('[SQLiteManager] Save to SQLite note:', e.message);
    }
  }
}

module.exports = new SQLiteManager();
