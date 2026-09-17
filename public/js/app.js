/**
 * SmartBus G4 & Z-Audio Home Automation Client Application
 *
 * Bi-directional WebSocket real-time synchronization, interactive UI rendering,
 * Z-Audio player controls, light dimming, 3-speed fan controls, scanner & UDP traffic inspector.
 */

let ws = null;
let state = {
  devices: [],
  hvac: [],
  curtains: [],
  scenes: [],
  discoveredModules: [],
  zaudio: {
    ip: '192.168.0.200',
    zones: {},
    sources: {}
  },
  system: {},
  queue: {
    mqtt: { status: 'disconnected' },
    queuesBreakdown: { HIGH: 0, NORMAL: 0, LOW: 0 },
    stats: { totalProcessed: 0 },
    recentJobs: [],
    recentLogs: []
  }
};

let selectedZoneId = 1;

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initWebSocket();
});

// -------------------------------------------------------------
// Navigation Tabs
// -------------------------------------------------------------
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.tab-page').forEach(page => page.classList.remove('active'));

      item.classList.add('active');
      const targetTab = item.getAttribute('data-tab');
      const targetPage = document.getElementById(targetTab);
      if (targetPage) targetPage.classList.add('active');

      // Update Page Titles
      const titleEl = document.getElementById('page-title');
      const subtitleEl = document.getElementById('page-subtitle');
      if (targetTab === 'tab-overview') {
        titleEl.textContent = 'Home Dashboard';
        subtitleEl.textContent = 'Real-time overview & quick controls';
      } else if (targetTab === 'tab-zaudio') {
        titleEl.textContent = 'Z-Audio Multi-Zone Music';
        subtitleEl.textContent = 'Z-Audio Controller (via Gateway 192.168.0.200)';
      } else if (targetTab === 'tab-lighting') {
        titleEl.textContent = 'Lighting & Fan Switches';
        subtitleEl.textContent = 'SmartBus G4 Dimmers, Relays, 3-Speed Fans & RGB Accent Lights';
      } else if (targetTab === 'tab-scanner') {
        titleEl.textContent = 'SmartBus Subnet Scanner & Setup';
        subtitleEl.textContent = 'Discover bus hardware modules & add custom equipment switches';
      } else if (targetTab === 'tab-climate') {
        titleEl.textContent = 'Climate & Air Conditioning';
        subtitleEl.textContent = 'HVAC setpoints, fan speeds & room temperature';
      } else if (targetTab === 'tab-scenes') {
        titleEl.textContent = 'Automation Scenes';
        subtitleEl.textContent = 'One-touch SmartBus macros & curtain controls';
      } else if (targetTab === 'tab-alexa') {
        titleEl.textContent = 'Amazon Alexa Voice Control';
        subtitleEl.textContent = 'Local UPnP discovery & Hue smart home bridge';
      } else if (targetTab === 'tab-bus') {
        titleEl.textContent = 'UDP Bus Diagnostics';
        subtitleEl.textContent = 'Real-time S-Bus packet inspector (Port 6000)';
      } else if (targetTab === 'tab-queue') {
        titleEl.textContent = 'Queue & MQTT Service';
        subtitleEl.textContent = 'Asynchronous priority command queue, MQTT broker sync & HA auto-discovery';
      } else if (targetTab === 'tab-settings') {
        titleEl.textContent = 'System Configuration';
        subtitleEl.textContent = 'ZAudio RSIP network & connection settings';
      }
    });
  });
}

// -------------------------------------------------------------
// WebSocket Client
// -------------------------------------------------------------
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WebSocket] Connected to SmartBus backend server.');
    updateConnectionIndicator(true);
  };

  ws.onclose = () => {
    console.warn('[WebSocket] Connection closed. Reconnecting in 3s...');
    updateConnectionIndicator(false);
    setTimeout(initWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.error('[WebSocket] Socket error:', err);
    updateConnectionIndicator(false);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (e) {
      console.error('[WebSocket] Failed to parse frame:', e);
    }
  };
}

function updateConnectionIndicator(online) {
  const ind = document.getElementById('sys-status-indicator');
  if (ind) {
    ind.className = online ? 'pulse-indicator online' : 'pulse-indicator offline';
  }
}

function handleServerMessage(msg) {
  if (msg.type === 'INITIAL_STATE') {
    state.devices = msg.data.devices.devices || [];
    state.hvac = msg.data.devices.hvac || [];
    state.curtains = msg.data.devices.curtains || [];
    state.scenes = msg.data.devices.scenes || [];
    state.discoveredModules = msg.data.devices.discoveredModules || [];
    state.zaudio = msg.data.zaudio || {};
    state.system = msg.data.system || {};
    if (msg.data.queue) state.queue = msg.data.queue;

    renderAllComponents();
  } else if (msg.type === 'DEVICE_UPDATED') {
    const idx = state.devices.findIndex(d => d.id === msg.device.id);
    if (idx !== -1) state.devices[idx] = msg.device;
    renderLighting();
    renderOverviewStats();
  } else if (msg.type === 'ZAUDIO_UPDATED') {
    state.zaudio = msg.zaudio;
    renderZAudioConsole();
    renderOverviewStats();
  } else if (msg.type === 'SNAPSHOT_UPDATED') {
    state.devices = msg.snapshot.devices || [];
    state.hvac = msg.snapshot.hvac || [];
    state.curtains = msg.snapshot.curtains || [];
    state.discoveredModules = msg.snapshot.discoveredModules || [];
    renderAllComponents();
  } else if (msg.type === 'SCAN_COMPLETED') {
    state.discoveredModules = msg.results || [];
    renderScannerResults();
  } else if (msg.type === 'BUS_LOG') {
    appendLogEntry(msg.log);
  } else if (msg.type === 'QUEUE_STATUS') {
    state.queue = msg.status;
    renderQueueDashboard();
  }
}

function sendWS(action, data = {}) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action, ...data }));
  }
}

// -------------------------------------------------------------
// Component Rendering
// -------------------------------------------------------------
function renderAllComponents() {
  renderOverviewStats();
  renderZAudioConsole();
  renderLighting();
  renderHVAC();
  renderScenesAndCurtains();
  renderScannerResults();
  renderQueueDashboard();
  renderSettings();
}

function renderOverviewStats() {
  const total = state.devices.length;
  const activeCount = state.devices.filter(d => d.power).length;
  const activeEl = document.getElementById('stat-active-lights');
  if (activeEl) activeEl.textContent = `${activeCount} / ${total}`;

  if (state.zaudio && state.zaudio.zones) {
    const activeZones = Object.values(state.zaudio.zones).filter(z => z.power).length;
    const activeZEl = document.getElementById('stat-active-zones');
    if (activeZEl) activeZEl.textContent = `${activeZones} Active Zone${activeZones === 1 ? '' : 's'}`;
  }

  const zone1 = state.zaudio.zones ? state.zaudio.zones[1] : null;
  if (zone1) {
    const trackEl = document.getElementById('overview-track');
    const artistEl = document.getElementById('overview-artist');
    const playBtn = document.getElementById('overview-play-btn');
    if (trackEl) trackEl.textContent = zone1.currentTrack || 'No Media Selected';
    if (artistEl) artistEl.textContent = `Source: ${zone1.sourceName || 'Bluetooth'} (Zone 1)`;
    if (playBtn) {
      playBtn.innerHTML = zone1.playbackState === 'playing' ? '<i class="ph-bold ph-pause"></i>' : '<i class="ph-bold ph-play"></i>';
    }
  }

  const quickContainer = document.getElementById('quick-lighting-container');
  if (quickContainer) {
    quickContainer.innerHTML = '';
    state.devices.slice(0, 5).forEach(dev => {
      const row = document.createElement('div');
      row.className = 'device-row';

      let iconClass = 'ph-lightbulb';
      if (dev.type === 'fan') iconClass = 'ph-fan';
      else if (dev.type === 'rgb') iconClass = 'ph-palette';

      row.innerHTML = `
        <div class="device-info">
          <div class="device-icon ${dev.power ? 'on' : ''}">
            <i class="ph-bold ${iconClass}"></i>
          </div>
          <div>
            <div style="font-weight:600">${dev.name}</div>
            <div style="font-size:12px;color:var(--text-muted)">${dev.room} &bull; ${dev.type === 'fan' ? 'Fan: ' + (dev.speedName || 'Off') : dev.type}</div>
          </div>
        </div>
        <input type="checkbox" class="toggle-switch" ${dev.power ? 'checked' : ''} onchange="toggleDevicePower('${dev.id}', this.checked)">
      `;
      quickContainer.appendChild(row);
    });
  }
}

// -------------------------------------------------------------
// Z-Audio Controller
// -------------------------------------------------------------
function selectZone(zoneId) {
  selectedZoneId = zoneId;
  const buttons = document.querySelectorAll('#zone-selector-bar .zone-btn');
  buttons.forEach((btn, idx) => {
    if (idx + 1 === zoneId) btn.classList.add('active');
    else btn.classList.remove('active');
  });
  renderZAudioConsole();
}

function renderZAudioConsole() {
  if (!state.zaudio || !state.zaudio.zones) return;
  const zone = state.zaudio.zones[selectedZoneId];
  if (!zone) return;

  const titleEl = document.getElementById('current-zone-title');
  if (titleEl) titleEl.textContent = `Zone ${zone.id}: ${zone.name}`;

  const powerChk = document.getElementById('zone-power-chk');
  if (powerChk) powerChk.checked = zone.power;

  const trackEl = document.getElementById('zaudio-track-title');
  const artistEl = document.getElementById('zaudio-artist-title');
  if (trackEl) trackEl.textContent = zone.currentTrack;
  if (artistEl) artistEl.innerHTML = `Artist: ${zone.artist} &bull; Source: <span>${zone.sourceName}</span>`;

  const mainPlayBtn = document.getElementById('zaudio-main-play-btn');
  if (mainPlayBtn) {
    mainPlayBtn.innerHTML = zone.playbackState === 'playing' ? '<i class="ph-bold ph-pause"></i>' : '<i class="ph-bold ph-play"></i>';
  }

  const volVal = document.getElementById('zaudio-vol-val');
  const volSlider = document.getElementById('zaudio-vol-slider');
  const muteIcon = document.getElementById('mute-icon');
  if (volVal) volVal.textContent = `${zone.volume} / 79`;
  if (volSlider) volSlider.value = zone.volume;
  if (muteIcon) {
    muteIcon.className = zone.muted ? 'ph-bold ph-speaker-slash' : 'ph-bold ph-speaker-high';
  }

  for (let i = 1; i <= 5; i++) {
    const srcBtn = document.getElementById(`src-btn-${i}`);
    if (srcBtn) {
      if (zone.source === i) srcBtn.classList.add('active');
      else srcBtn.classList.remove('active');
    }
  }

  const eqChips = document.querySelectorAll('.eq-chip');
  eqChips.forEach(chip => {
    if (chip.textContent.trim().toLowerCase() === (zone.eq || '').toLowerCase()) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function toggleZonePower(checked) {
  sendWS('CONTROL_ZAUDIO', { zoneId: selectedZoneId, type: 'power', value: checked });
}

function toggleZAudioMainPlay() {
  const zone = state.zaudio.zones[selectedZoneId];
  const nextAction = zone && zone.playbackState === 'playing' ? 'pause' : 'play';
  sendWS('CONTROL_ZAUDIO', { zoneId: selectedZoneId, type: 'playback', value: nextAction });
}

function toggleOverviewPlayback() {
  sendWS('CONTROL_ZAUDIO', { zoneId: 1, type: 'playback', value: 'play' });
}

function controlZAudioQuick(action) {
  sendWS('CONTROL_ZAUDIO', { zoneId: 1, type: 'playback', value: action });
}

function onVolumeSliderChange(val) {
  sendWS('CONTROL_ZAUDIO', { zoneId: selectedZoneId, type: 'volume', value: parseInt(val) });
}

function selectSource(sourceId) {
  sendWS('CONTROL_ZAUDIO', { zoneId: selectedZoneId, type: 'source', value: sourceId });
}

function selectEQ(eqName) {
  sendWS('CONTROL_ZAUDIO', { zoneId: selectedZoneId, type: 'eq', value: eqName });
}

function sendZAudioAction(type, value = null) {
  sendWS('CONTROL_ZAUDIO', { zoneId: selectedZoneId, type, value });
}

// -------------------------------------------------------------
// Lighting & Fan Controls UI
// -------------------------------------------------------------
function renderLighting() {
  const container = document.getElementById('lighting-container');
  if (!container) return;

  const roomMap = {};
  state.devices.forEach(dev => {
    if (!roomMap[dev.room]) roomMap[dev.room] = [];
    roomMap[dev.room].push(dev);
  });

  container.innerHTML = '';
  Object.keys(roomMap).forEach(roomName => {
    const roomCard = document.createElement('div');
    roomCard.className = 'glass-card';

    let devRowsHTML = '';
    roomMap[roomName].forEach(dev => {
      let iconClass = 'ph-lightbulb';
      if (dev.type === 'fan') iconClass = 'ph-fan';
      else if (dev.type === 'rgb') iconClass = 'ph-palette';

      let controlHTML = '';
      if (dev.type === 'fan') {
        controlHTML = `
          <div style="display:flex;align-items:center;gap:6px">
            <button class="eq-chip ${dev.level === 1 ? 'active' : ''}" onclick="setDeviceLevel('${dev.id}', 1)">Low</button>
            <button class="eq-chip ${dev.level === 2 ? 'active' : ''}" onclick="setDeviceLevel('${dev.id}', 2)">Med</button>
            <button class="eq-chip ${dev.level === 3 ? 'active' : ''}" onclick="setDeviceLevel('${dev.id}', 3)">High</button>
          </div>
        `;
      } else if (dev.type === 'dimmer') {
        controlHTML = `
          <input type="range" min="0" max="100" value="${dev.level}" class="custom-slider" style="width:100px" onchange="setDeviceLevel('${dev.id}', this.value)">
          <span style="font-size:12px;width:32px">${dev.level}%</span>
        `;
      }

      devRowsHTML += `
        <div class="device-row">
          <div class="device-info">
            <div class="device-icon ${dev.power ? 'on' : ''}">
              <i class="ph-bold ${iconClass}"></i>
            </div>
            <div>
              <div style="font-weight:600">${dev.name}</div>
              <div style="font-size:12px;color:var(--text-muted)">Subnet ${dev.subnet} &bull; Device ${dev.deviceId} &bull; Ch ${dev.channel} ${dev.type === 'fan' ? '&bull; ' + (dev.speedName || 'Off') : ''}</div>
            </div>
          </div>
          
          <div style="display:flex;align-items:center;gap:12px">
            ${controlHTML}
            <input type="checkbox" class="toggle-switch" ${dev.power ? 'checked' : ''} onchange="toggleDevicePower('${dev.id}', this.checked)">
            <button class="btn-icon" onclick="deleteDevice('${dev.id}')" title="Delete Switch" style="width:28px;height:28px;font-size:14px;color:var(--accent-rose)"><i class="ph-bold ph-trash"></i></button>
          </div>
        </div>
      `;
    });

    roomCard.innerHTML = `
      <h3><i class="ph-bold ph-house-line"></i> ${roomName}</h3>
      <div style="margin-top:16px">${devRowsHTML}</div>
    `;
    container.appendChild(roomCard);
  });
}

function toggleDevicePower(id, checked) {
  sendWS('CONTROL_DEVICE', { id, updates: { power: checked } });
}

function setDeviceLevel(id, level) {
  sendWS('CONTROL_DEVICE', { id, updates: { level: parseInt(level) } });
}

function deleteDevice(id) {
  if (confirm('Delete this equipment switch from dashboard?')) {
    sendWS('DELETE_DEVICE', { id });
  }
}

// -------------------------------------------------------------
// SmartBus Subnet Scanner & Setup
// -------------------------------------------------------------
function startSubnetScan() {
  sendWS('START_SCANNER', { subnet: 1 });
}

function renderScannerResults() {
  const container = document.getElementById('scanner-results-list');
  if (!container) return;

  if (!state.discoveredModules || state.discoveredModules.length === 0) {
    container.innerHTML = `
      <div class="device-row">
        <div class="device-info">
          <div class="device-icon"><i class="ph-bold ph-info"></i></div>
          <div>
            <div style="font-weight:600">No hardware scan executed</div>
            <div style="font-size:12px;color:var(--text-muted)">Click "Scan Subnet 1" above to discover hardware</div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  state.discoveredModules.forEach(mod => {
    const item = document.createElement('div');
    item.className = 'device-row';
    item.innerHTML = `
      <div class="device-info">
        <div class="device-icon on"><i class="ph-bold ph-cpu"></i></div>
        <div>
          <div style="font-weight:600">${mod.name}</div>
          <div style="font-size:12px;color:var(--text-muted)">Subnet ${mod.subnet} &bull; Device ID ${mod.deviceId} &bull; Type: ${mod.type} (${mod.channels} Channels)</div>
        </div>
      </div>
      <button class="btn-primary" style="padding:6px 12px;font-size:12px" onclick="autoAddModuleChannels(${mod.subnet}, ${mod.deviceId}, '${mod.name}', '${mod.type}', ${mod.channels})">
        <i class="ph-bold ph-plus"></i> Import Channels
      </button>
    `;
    container.appendChild(item);
  });
}

function autoAddModuleChannels(subnet, deviceId, name, type, channels) {
  for (let ch = 1; ch <= Math.min(channels, 4); ch++) {
    sendWS('ADD_DEVICE', {
      deviceData: {
        name: `${name} Ch ${ch}`,
        room: 'Living Room',
        type: type.includes('Dimmer') ? 'dimmer' : (type.includes('Fan') ? 'fan' : 'relay'),
        subnet,
        deviceId,
        channel: ch
      }
    });
  }
  alert(`Imported channels from ${name} to dashboard!`);
}

function handleAddDevice(e) {
  e.preventDefault();
  const name = document.getElementById('new-dev-name').value;
  const room = document.getElementById('new-dev-room').value;
  const type = document.getElementById('new-dev-type').value;
  const subnet = parseInt(document.getElementById('new-dev-subnet').value) || 1;
  const deviceId = parseInt(document.getElementById('new-dev-deviceid').value) || 10;
  const channel = parseInt(document.getElementById('new-dev-channel').value) || 1;

  sendWS('ADD_DEVICE', {
    deviceData: { name, room, type, subnet, deviceId, channel }
  });

  document.getElementById('add-device-form').reset();
  alert(`Added ${name} switch successfully!`);
}

// -------------------------------------------------------------
// Climate / HVAC UI
// -------------------------------------------------------------
function renderHVAC() {
  const container = document.getElementById('hvac-container');
  if (!container) return;

  container.innerHTML = '';
  state.hvac.forEach(unit => {
    const card = document.createElement('div');
    card.className = 'glass-card';
    card.innerHTML = `
      <div class="card-header">
        <h3><i class="ph-bold ph-thermometer-cold"></i> ${unit.name}</h3>
        <input type="checkbox" class="toggle-switch" ${unit.power ? 'checked' : ''} onchange="toggleHVACPower('${unit.id}', this.checked)">
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;background:rgba(0,0,0,0.3);padding:20px;border-radius:12px;margin-bottom:16px">
        <div>
          <div style="font-size:12px;color:var(--text-muted)">CURRENT TEMP</div>
          <div style="font-size:28px;font-weight:700;color:var(--accent-cyan)">${unit.currentTemp} °C</div>
        </div>
        
        <div style="display:flex;align-items:center;gap:12px">
          <button class="btn-icon" onclick="changeHVACOffset('${unit.id}', -1)"><i class="ph-bold ph-minus"></i></button>
          <div style="text-align:center">
            <div style="font-size:12px;color:var(--text-muted)">TARGET</div>
            <div style="font-size:24px;font-weight:700">${unit.targetTemp} °C</div>
          </div>
          <button class="btn-icon" onclick="changeHVACOffset('${unit.id}', 1)"><i class="ph-bold ph-plus"></i></button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function toggleHVACPower(id, power) {
  sendWS('CONTROL_HVAC', { id, updates: { power } });
}

function changeHVACOffset(id, delta) {
  const unit = state.hvac.find(u => u.id === id);
  if (unit) {
    const newTemp = unit.targetTemp + delta;
    sendWS('CONTROL_HVAC', { id, updates: { targetTemp: newTemp } });
  }
}

// -------------------------------------------------------------
// Scenes & Curtains
// -------------------------------------------------------------
function renderScenesAndCurtains() {
  const scenesContainer = document.getElementById('scenes-container');
  if (scenesContainer) {
    scenesContainer.innerHTML = '';
    state.scenes.forEach(scene => {
      const item = document.createElement('div');
      item.className = 'device-row';
      item.innerHTML = `
        <div class="device-info">
          <div class="device-icon on"><i class="ph-bold ${scene.icon || 'ph-sparkles'}"></i></div>
          <div>
            <div style="font-weight:600">${scene.name}</div>
            <div style="font-size:12px;color:var(--text-muted)">${scene.description}</div>
          </div>
        </div>
        <button class="btn-primary" onclick="triggerQuickScene('${scene.id}')"><i class="ph-bold ph-play"></i> Run Macro</button>
      `;
      scenesContainer.appendChild(item);
    });
  }

  const curtainsContainer = document.getElementById('curtains-container');
  if (curtainsContainer) {
    curtainsContainer.innerHTML = '';
    state.curtains.forEach(curtain => {
      const item = document.createElement('div');
      item.className = 'device-row';
      item.innerHTML = `
        <div class="device-info">
          <div class="device-icon"><i class="ph-bold ph-blinds"></i></div>
          <div>
            <div style="font-weight:600">${curtain.name}</div>
            <div style="font-size:12px;color:var(--text-muted)">${curtain.room} &bull; Position: ${curtain.position}%</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="btn-icon" onclick="setCurtain('${curtain.id}', 0)" title="Close"><i class="ph-bold ph-caret-left"></i></button>
          <button class="btn-icon" onclick="setCurtain('${curtain.id}', 50)" title="Half"><i class="ph-bold ph-arrows-out-line-horizontal"></i></button>
          <button class="btn-icon" onclick="setCurtain('${curtain.id}', 100)" title="Fully Open"><i class="ph-bold ph-caret-right"></i></button>
        </div>
      `;
      curtainsContainer.appendChild(item);
    });
  }
}

function triggerQuickScene(sceneId) {
  sendWS('TRIGGER_SCENE', { sceneId });
}

function setCurtain(id, position) {
  sendWS('CONTROL_CURTAIN', { id, position });
}

// -------------------------------------------------------------
// Bus UDP Packet Inspector
// -------------------------------------------------------------
function appendLogEntry(log) {
  const consoleEl = document.getElementById('log-console');
  if (!consoleEl) return;

  const entry = document.createElement('div');
  const dirClass = (log.direction || '').toLowerCase();
  entry.className = `log-entry ${dirClass}`;
  entry.innerHTML = `<span class="time">[${log.timestamp || new Date().toLocaleTimeString()}]</span> [${log.direction || 'UDP'}] ${log.ip}:${log.port} ${log.details} ${log.hex ? '| Hex: ' + log.hex : ''}`;

  consoleEl.appendChild(entry);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearLogs() {
  const consoleEl = document.getElementById('log-console');
  if (consoleEl) consoleEl.innerHTML = '';
}

function injectTestUDP() {
  sendWS('CONTROL_DEVICE', { id: 'light_lr_main', updates: { power: true, level: 85 } });
}

// -------------------------------------------------------------
// Queue Service & MQTT UI Manager
// -------------------------------------------------------------
function renderQueueDashboard() {
  if (!state.queue) return;
  const q = state.queue;

  // 1. MQTT Status Badge
  const mqttStatusEl = document.getElementById('stat-mqtt-status');
  const mqttIconEl = document.getElementById('stat-mqtt-icon');
  if (mqttStatusEl && q.mqtt) {
    const status = q.mqtt.status || 'disconnected';
    mqttStatusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    if (mqttIconEl) {
      if (status === 'connected') mqttIconEl.className = 'stat-icon green';
      else if (status === 'connecting') mqttIconEl.className = 'stat-icon yellow';
      else mqttIconEl.className = 'stat-icon red';
    }
  }

  // 2. Stats
  const lenEl = document.getElementById('stat-queue-length');
  if (lenEl) lenEl.textContent = `${q.queueLength || 0} Jobs`;

  const procEl = document.getElementById('stat-queue-processed');
  if (procEl && q.stats) procEl.textContent = q.stats.totalProcessed || 0;

  const delayEl = document.getElementById('stat-queue-delay');
  if (delayEl) delayEl.textContent = `${q.interCommandDelay || 100} ms`;

  const delayDisp = document.getElementById('queue-delay-display');
  const delaySlider = document.getElementById('queue-delay-slider');
  if (delayDisp) delayDisp.textContent = `${q.interCommandDelay || 100} ms`;
  if (delaySlider && document.activeElement !== delaySlider) delaySlider.value = q.interCommandDelay || 100;

  // 3. Pause/Resume Button
  const pauseBtn = document.getElementById('btn-toggle-pause');
  if (pauseBtn) {
    if (q.isPaused) {
      pauseBtn.className = 'btn-secondary success';
      pauseBtn.innerHTML = '<i class="ph-bold ph-play"></i> Resume Queue';
    } else {
      pauseBtn.className = 'btn-secondary';
      pauseBtn.innerHTML = '<i class="ph-bold ph-pause"></i> Pause Queue';
    }
  }

  // 4. Render Active Queue Table
  const tbody = document.getElementById('queue-jobs-tbody');
  if (tbody) {
    const allJobs = [];
    if (q.activeJob) allJobs.push(q.activeJob);
    if (q.recentJobs) allJobs.push(...q.recentJobs);

    if (allJobs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:20px;text-align:center;color:var(--text-muted)">No active commands in queue</td></tr>`;
    } else {
      tbody.innerHTML = '';
      allJobs.forEach(job => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';

        let priorityBadge = '<span class="badge-tag normal">NORMAL</span>';
        if (job.priority === 'HIGH') priorityBadge = '<span class="badge-tag high">HIGH</span>';
        else if (job.priority === 'LOW') priorityBadge = '<span class="badge-tag low">LOW</span>';

        let statusTag = `<span class="status-pill ${job.status}">${job.status.toUpperCase()}</span>`;

        tr.innerHTML = `
          <td style="padding:10px;font-family:monospace;font-size:11px">${job.id}</td>
          <td style="padding:10px;font-weight:600">${job.type}</td>
          <td style="padding:10px">${job.targetId || '-'}</td>
          <td style="padding:10px">${priorityBadge}</td>
          <td style="padding:10px;color:var(--text-muted)">${job.source || 'API'}</td>
          <td style="padding:10px">${statusTag}</td>
        `;
        tbody.appendChild(tr);
      });
    }
  }

  // 5. Render MQTT Logs
  const mqttConsole = document.getElementById('mqtt-log-console');
  if (mqttConsole && q.recentLogs) {
    mqttConsole.innerHTML = '';
    q.recentLogs.slice(0, 20).forEach(log => {
      const entry = document.createElement('div');
      entry.className = 'log-entry rx';
      entry.innerHTML = `<span class="time">[${log.timestamp}]</span> ${log.message}`;
      mqttConsole.appendChild(entry);
    });
    mqttConsole.scrollTop = mqttConsole.scrollHeight;
  }
}

function toggleQueuePause() {
  const isCurrentlyPaused = state.queue && state.queue.isPaused;
  sendWS('SET_QUEUE_PAUSED', { paused: !isCurrentlyPaused });
}

function purgeQueue() {
  if (confirm('Purge all pending commands in the queue?')) {
    sendWS('PURGE_QUEUE');
  }
}

function updateQueueDelay(val) {
  const delay = parseInt(val) || 100;
  sendWS('UPDATE_MQTT_CONFIG', { config: { interCommandDelay: delay } });
}

function handleTestEnqueue(e) {
  e.preventDefault();
  const id = document.getElementById('test-cmd-id').value;
  const action = document.getElementById('test-cmd-action').value;
  const priority = document.getElementById('test-cmd-priority').value;

  let updates = {};
  if (action === 'ON') updates = { power: true, level: 100 };
  else if (action === 'OFF') updates = { power: false, level: 0 };
  else updates = { level: parseInt(action) };

  sendWS('CONTROL_DEVICE', { id, updates, priority });
  alert(`Dispatched ${priority} priority command for ${id}!`);
}

function saveMQTTConfig(e) {
  e.preventDefault();
  const brokerUrl = document.getElementById('mqtt-broker-url').value;
  const topicPrefix = document.getElementById('mqtt-topic-prefix').value;
  const clientId = document.getElementById('mqtt-client-id').value;
  const username = document.getElementById('mqtt-username').value;
  const password = document.getElementById('mqtt-password').value;
  const haDiscovery = document.getElementById('mqtt-ha-discovery-chk').checked;

  sendWS('UPDATE_MQTT_CONFIG', {
    config: { brokerUrl, topicPrefix, clientId, username, password, haDiscovery }
  });

  alert('MQTT Broker configuration saved! Reconnecting...');
}

// -------------------------------------------------------------
// Settings
// -------------------------------------------------------------
function renderSettings() {
  const ipInput = document.getElementById('cfg-gateway-ip');
  if (ipInput) {
    ipInput.value = state.gatewayIp || '192.168.0.200';
  }
}

function saveSettings(e) {
  e.preventDefault();
  const gatewayIp = document.getElementById('cfg-gateway-ip').value;
  const simulationMode = document.getElementById('cfg-simulation-chk').checked;

  sendWS('UPDATE_SETTINGS', {
    settings: { gatewayIp, simulationMode }
  });

  alert('Configuration updated successfully!');
}
