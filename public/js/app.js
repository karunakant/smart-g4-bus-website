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
function toggleMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.toggle('mobile-open');
  if (overlay) overlay.classList.toggle('active');
}

function closeMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (overlay) overlay.classList.remove('active');
}

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

      closeMobileMenu();

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
        loadAlexaStatus();
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

let overviewRoomFilter = 'all';

function renderOverviewStats() {
  if (!state.devices) return;

  // 1. Metric: Active Lights & Fans from DB
  const total = state.devices.length;
  const activeCount = state.devices.filter(d => d.power).length;
  const activeEl = document.getElementById('stat-active-lights');
  if (activeEl) activeEl.textContent = `${activeCount} / ${total}`;

  // 2. Metric: Active Z-Audio Zones from DB
  if (state.zaudio && state.zaudio.zones) {
    const activeZones = Object.values(state.zaudio.zones).filter(z => z.power).length;
    const activeZEl = document.getElementById('stat-active-zones');
    if (activeZEl) activeZEl.textContent = `${activeZones} Active Zone${activeZones === 1 ? '' : 's'}`;
  }

  // 3. Metric: Climate Temperature from DB (state.hvac)
  const hvacList = state.hvac || [];
  const hallAC = hvacList.find(h => h.room === 'Hall' || (h.name && h.name.includes('Hall'))) || hvacList[0];
  const tempEl = document.getElementById('stat-current-temp');
  if (tempEl && hallAC) {
    tempEl.textContent = `${hallAC.currentTemp || 24.5} °C`;
  }

  // 4. Z-Audio Player Widget from DB
  const zone1 = state.zaudio && state.zaudio.zones ? state.zaudio.zones[1] : null;
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

  // 5. Render Overview Room Filter Chips & Equipment Controls from DB
  renderOverviewEquipment();

  // 6. Render Overview HVAC Controls from DB
  renderOverviewHVAC();
}

function renderOverviewEquipment() {
  const chipContainer = document.getElementById('overview-room-chips');
  const container = document.getElementById('quick-lighting-container');
  if (!container) return;

  // Extract rooms from DB
  const rooms = [...new Set(state.devices.map(d => d.room))];

  if (chipContainer) {
    let chipsHTML = `<button class="filter-chip ${overviewRoomFilter === 'all' ? 'active' : ''}" onclick="setOverviewRoomFilter('all')">All DB Rooms (${state.devices.length})</button>`;
    rooms.forEach(r => {
      const count = state.devices.filter(d => d.room === r).length;
      chipsHTML += `<button class="filter-chip ${overviewRoomFilter === r ? 'active' : ''}" onclick="setOverviewRoomFilter('${r.replace(/'/g, "\\'")}')">${r} (${count})</button>`;
    });
    chipContainer.innerHTML = chipsHTML;
  }

  // Filter devices by selected room
  let displayDevs = state.devices;
  if (overviewRoomFilter !== 'all') {
    displayDevs = state.devices.filter(d => d.room === overviewRoomFilter);
  }

  container.innerHTML = '';
  if (displayDevs.length === 0) {
    container.innerHTML = `<div style="color:var(--text-muted);font-size:13px;padding:12px;grid-column:1/-1;">No equipment devices found in DB for this room.</div>`;
    return;
  }

  displayDevs.forEach(dev => {
    let iconClass = 'ph-lightbulb';
    if (dev.type === 'fan') iconClass = 'ph-fan';
    else if (dev.type === 'rgb') iconClass = 'ph-palette';
    else if (dev.type === 'dimmer') iconClass = 'ph-sliders';

    let controlHTML = '';
    if (dev.type === 'fan') {
      controlHTML = `
        <div class="fan-speed-chips">
          <button class="speed-chip ${dev.level === 0 ? 'active' : ''}" onclick="setDeviceLevel('${dev.id}', 0); event.stopPropagation();">Off</button>
          <button class="speed-chip ${dev.level === 1 ? 'active' : ''}" onclick="setDeviceLevel('${dev.id}', 1); event.stopPropagation();">Low</button>
          <button class="speed-chip ${dev.level === 2 ? 'active' : ''}" onclick="setDeviceLevel('${dev.id}', 2); event.stopPropagation();">Med</button>
          <button class="speed-chip ${dev.level === 3 ? 'active' : ''}" onclick="setDeviceLevel('${dev.id}', 3); event.stopPropagation();">High</button>
        </div>
      `;
    } else if (dev.type === 'dimmer') {
      controlHTML = `
        <div class="dimmer-control-wrapper">
          <input type="range" min="0" max="100" value="${dev.level}" class="custom-slider dimmer-slider" onchange="setDeviceLevel('${dev.id}', this.value)" onclick="event.stopPropagation()">
          <span class="dimmer-val-badge ${dev.power ? 'on' : ''}">${dev.level}%</span>
        </div>
      `;
    }

    const isFanSpinning = dev.type === 'fan' && dev.power && dev.level > 0;

    const row = document.createElement('div');
    row.className = `device-row ${dev.power ? 'is-on' : ''}`;
    row.innerHTML = `
      <div class="device-info">
        <div class="device-icon ${dev.power ? 'on' : ''} ${isFanSpinning ? 'spinning' : ''}">
          <i class="ph-bold ${iconClass}"></i>
        </div>
        <div class="device-text">
          <div class="device-name">${dev.name}</div>
          <div class="device-subtext">${dev.room} &bull; Subnet ${dev.subnet}:${dev.deviceId} ${dev.type === 'fan' ? '&bull; <span class="speed-tag">' + (dev.speedName || 'Off') + '</span>' : ''}</div>
        </div>
      </div>

      <div class="device-actions">
        ${controlHTML}
        <input type="checkbox" class="toggle-switch" ${dev.power ? 'checked' : ''} onchange="toggleDevicePower('${dev.id}', this.checked)" onclick="event.stopPropagation()">
      </div>
    `;
    container.appendChild(row);
  });
}

function setOverviewRoomFilter(room) {
  overviewRoomFilter = room;
  renderOverviewEquipment();
}

function renderOverviewHVAC() {
  const container = document.getElementById('overview-hvac-container');
  if (!container) return;

  const hvacList = state.hvac || [];
  container.innerHTML = '';

  if (hvacList.length === 0) {
    container.innerHTML = `<div style="color:var(--text-muted);font-size:13px;">No HVAC units in DB</div>`;
    return;
  }

  hvacList.forEach(unit => {
    const row = document.createElement('div');
    row.className = `device-row ${unit.power ? 'is-on' : ''}`;
    row.innerHTML = `
      <div class="device-info">
        <div class="device-icon ${unit.power ? 'on' : ''}">
          <i class="ph-bold ph-snowflake"></i>
        </div>
        <div class="device-text">
          <div class="device-name">${unit.name}</div>
          <div class="device-subtext">${unit.room} &bull; Room: ${unit.currentTemp}°C &bull; Target: ${unit.targetTemp}°C</div>
        </div>
      </div>

      <div class="device-actions">
        <div style="display:flex;align-items:center;gap:6px">
          <button class="btn-icon" style="width:26px;height:26px" onclick="setHVACOverviewTemp('${unit.id}', ${unit.targetTemp - 1})">-</button>
          <span style="font-weight:700;font-size:13px;width:38px;text-align:center">${unit.targetTemp}°C</span>
          <button class="btn-icon" style="width:26px;height:26px" onclick="setHVACOverviewTemp('${unit.id}', ${unit.targetTemp + 1})">+</button>
        </div>
        <input type="checkbox" class="toggle-switch" ${unit.power ? 'checked' : ''} onchange="toggleHVACPower('${unit.id}', this.checked)">
      </div>
    `;
    container.appendChild(row);
  });
}

function setHVACOverviewTemp(id, targetTemp) {
  sendWS('CONTROL_HVAC', { id, updates: { targetTemp } });
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
let expandedGroups = {};
let currentLightingFilter = 'all';

function renderLighting() {
  const container = document.getElementById('lighting-container');
  if (!container) return;

  // Filter devices by category if selected
  let devices = state.devices;
  if (currentLightingFilter !== 'all') {
    devices = devices.filter(d => d.type === currentLightingFilter);
  }

  // Group devices by Room
  const roomMap = {};
  devices.forEach(dev => {
    if (!roomMap[dev.room]) roomMap[dev.room] = [];
    roomMap[dev.room].push(dev);
  });

  container.innerHTML = '';

  if (Object.keys(roomMap).length === 0) {
    container.innerHTML = `
      <div class="glass-card" style="grid-column: 1 / -1; text-align: center; padding: 40px;">
        <i class="ph-bold ph-lightbulb-slash" style="font-size: 36px; color: var(--text-muted); margin-bottom: 12px; display: block;"></i>
        <div style="font-size: 16px; font-weight: 600;">No equipment matches filter "${currentLightingFilter}"</div>
        <div style="font-size: 13px; color: var(--text-muted); margin-top: 4px;">Click "All Rooms" above to show all lighting & fan cards.</div>
      </div>
    `;
    return;
  }

  Object.keys(roomMap).forEach(roomName => {
    const roomDevs = roomMap[roomName];
    const isExpanded = !!expandedGroups[roomName];

    // Metrics & Active calculations
    const activeDevs = roomDevs.filter(d => d.power);
    const hasActive = activeDevs.length > 0;

    const fanCount = roomDevs.filter(d => d.type === 'fan').length;
    const dimmerCount = roomDevs.filter(d => d.type === 'dimmer').length;
    const relayCount = roomDevs.filter(d => d.type === 'relay' || d.type === 'rgb').length;

    let statusText = 'All Off';
    if (hasActive) {
      statusText = `${activeDevs.length} of ${roomDevs.length} Active`;
    }

    const isMasterOn = hasActive;

    const groupCard = document.createElement('div');
    groupCard.className = `group-card ${isExpanded ? 'is-expanded' : ''} ${hasActive ? 'has-active' : ''}`;

    let devRowsHTML = '';
    roomDevs.forEach(dev => {
      let iconClass = 'ph-lightbulb';
      if (dev.type === 'fan') iconClass = 'ph-fan';
      else if (dev.type === 'rgb') iconClass = 'ph-palette';
      else if (dev.type === 'dimmer') iconClass = 'ph-sliders';

      let controlHTML = '';
      if (dev.type === 'fan') {
        controlHTML = `
          <div class="fan-speed-chips">
            <button class="speed-chip ${dev.level === 0 ? 'active' : ''}" onclick="setDeviceLevel('${dev.id}', 0); event.stopPropagation();">Off</button>
            <button class="speed-chip ${dev.level === 1 ? 'active' : ''}" onclick="setDeviceLevel('${dev.id}', 1); event.stopPropagation();">Low</button>
            <button class="speed-chip ${dev.level === 2 ? 'active' : ''}" onclick="setDeviceLevel('${dev.id}', 2); event.stopPropagation();">Med</button>
            <button class="speed-chip ${dev.level === 3 ? 'active' : ''}" onclick="setDeviceLevel('${dev.id}', 3); event.stopPropagation();">High</button>
          </div>
        `;
      } else if (dev.type === 'dimmer') {
        controlHTML = `
          <div class="dimmer-control-wrapper">
            <input type="range" min="0" max="100" value="${dev.level}" class="custom-slider dimmer-slider" onchange="setDeviceLevel('${dev.id}', this.value)" onclick="event.stopPropagation()">
            <span class="dimmer-val-badge ${dev.power ? 'on' : ''}">${dev.level}%</span>
          </div>
        `;
      }

      const isFanSpinning = dev.type === 'fan' && dev.power && dev.level > 0;

      devRowsHTML += `
        <div class="device-row ${dev.power ? 'is-on' : ''}">
          <div class="device-info">
            <div class="device-icon ${dev.power ? 'on' : ''} ${isFanSpinning ? 'spinning' : ''}">
              <i class="ph-bold ${iconClass}"></i>
            </div>
            <div class="device-text">
              <div class="device-name">${dev.name}</div>
              <div class="device-subtext">Subnet ${dev.subnet} &bull; Dev ${dev.deviceId} &bull; Ch ${dev.channel} ${dev.type === 'fan' ? '&bull; <span class="speed-tag">' + (dev.speedName || 'Off') + '</span>' : ''}</div>
            </div>
          </div>
          
          <div class="device-actions">
            ${controlHTML}
            <input type="checkbox" class="toggle-switch" ${dev.power ? 'checked' : ''} onchange="toggleDevicePower('${dev.id}', this.checked)" onclick="event.stopPropagation()">
            <button class="btn-icon delete-btn" onclick="deleteDevice('${dev.id}'); event.stopPropagation();" title="Delete Switch"><i class="ph-bold ph-trash"></i></button>
          </div>
        </div>
      `;
    });

    groupCard.innerHTML = `
      <div class="group-card-header" onclick="toggleGroupExpand('${roomName.replace(/'/g, "\\'")}')">
        <div class="group-title-area">
          <div class="group-icon">
            <i class="ph-bold ${getRoomIcon(roomName)}"></i>
          </div>
          <div class="group-info">
            <div class="group-name">${roomName}</div>
            <div class="group-meta">
              <span class="status-pill ${hasActive ? 'completed' : ''}">${statusText}</span>
              <span>&bull; ${roomDevs.length} ${roomDevs.length === 1 ? 'device' : 'devices'}</span>
            </div>
          </div>
        </div>

        <div class="group-header-controls">
          <div style="display:flex;align-items:center;gap:8px" onclick="event.stopPropagation()">
            <span style="font-size:12px;color:var(--text-muted);font-weight:500">Group</span>
            <input type="checkbox" class="toggle-switch" ${isMasterOn ? 'checked' : ''} onchange="toggleGroupPower('${roomName.replace(/'/g, "\\'")}', this.checked)">
          </div>
          <div class="expand-chevron">
            <i class="ph-bold ph-caret-down"></i>
          </div>
        </div>
      </div>

      <div class="group-summary-bar">
        ${fanCount > 0 ? `<span class="summary-badge ${roomDevs.some(d => d.type === 'fan' && d.power) ? 'active' : ''}"><i class="ph-bold ph-fan"></i> ${fanCount} Fans</span>` : ''}
        ${dimmerCount > 0 ? `<span class="summary-badge ${roomDevs.some(d => d.type === 'dimmer' && d.power) ? 'active' : ''}"><i class="ph-bold ph-sliders"></i> ${dimmerCount} Dimmers</span>` : ''}
        ${relayCount > 0 ? `<span class="summary-badge ${roomDevs.some(d => (d.type === 'relay' || d.type === 'rgb') && d.power) ? 'active' : ''}"><i class="ph-bold ph-lightning"></i> ${relayCount} Relays</span>` : ''}
      </div>

      <div class="group-card-body">
        <div style="display:flex;flex-direction:column;gap:10px">${devRowsHTML}</div>
      </div>
    `;

    container.appendChild(groupCard);
  });
}

function getRoomIcon(roomName) {
  const name = roomName.toLowerCase();
  if (name.includes('kitchen')) return 'ph-cooking-pot';
  if (name.includes('bedroom')) return 'ph-bed';
  if (name.includes('living')) return 'ph-armchair';
  if (name.includes('balcony') || name.includes('outdoor')) return 'ph-tree';
  if (name.includes('bath')) return 'ph-drop';
  if (name.includes('dining')) return 'ph-fork-knife';
  return 'ph-house';
}

function toggleGroupExpand(roomName) {
  expandedGroups[roomName] = !expandedGroups[roomName];
  renderLighting();
}

function toggleAllGroups(expandState) {
  const roomNames = [...new Set(state.devices.map(d => d.room))];
  roomNames.forEach(r => {
    expandedGroups[r] = expandState;
  });
  renderLighting();
}

function toggleGroupPower(roomName, power) {
  const roomDevs = state.devices.filter(d => d.room === roomName);
  roomDevs.forEach(dev => {
    sendWS('CONTROL_DEVICE', { id: dev.id, updates: { power } });
  });
}

function turnOffAllLighting() {
  const activeCount = state.devices.filter(d => d.power).length;
  if (activeCount === 0) return;

  if (confirm(`Turn OFF all ${activeCount} active lights and fans across all rooms?`)) {
    state.devices.forEach(dev => {
      if (dev.power) {
        sendWS('CONTROL_DEVICE', { id: dev.id, updates: { power: false } });
      }
    });
  }
}

function setLightingFilter(filter) {
  currentLightingFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`filter-chip-${filter}`);
  if (activeBtn) activeBtn.classList.add('active');
  renderLighting();
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

async function publishHADiscoveryNow() {
  try {
    const res = await fetch('/api/ha/discovery', { method: 'POST' });
    const data = await res.json();
    alert('Home Assistant MQTT Auto-Discovery published! All lights, switches, fans, climate & curtains are now broadcast to Home Assistant.');
  } catch (err) {
    alert('Failed to publish discovery: ' + err.message);
  }
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

// -------------------------------------------------------------
// Alexa Diagnostics & Voice Simulator
// -------------------------------------------------------------
let alexaCachedDevices = [];

async function loadAlexaStatus() {
  try {
    const res = await fetch('/api/alexa/status');
    const data = await res.json();

    const ipEl = document.getElementById('alexa-bridge-ip');
    const portEl = document.getElementById('alexa-bridge-port');
    const countEl = document.getElementById('alexa-bridge-device-count');
    const badgeEl = document.getElementById('alexa-bridge-badge');

    if (ipEl) ipEl.textContent = data.hostIp || '127.0.0.1';
    if (portEl) portEl.textContent = `Port ${data.advertisedPort || 80}`;
    if (countEl) countEl.textContent = data.deviceCount || 0;
    if (badgeEl) {
      badgeEl.innerHTML = `<i class="ph-bold ph-broadcast"></i> Bridge Active (${data.hostIp}:${data.advertisedPort})`;
    }

    alexaCachedDevices = data.devices || [];
    populateAlexaSimulator(alexaCachedDevices);
    renderAlexaTable(alexaCachedDevices);
  } catch (e) {
    console.warn('[Alexa UI] Failed to load bridge status:', e.message);
  }
}

function populateAlexaSimulator(devices) {
  const select = document.getElementById('alexa-sim-device');
  if (!select) return;

  if (!devices || devices.length === 0) {
    select.innerHTML = '<option value="">No devices exposed</option>';
    return;
  }

  select.innerHTML = devices.map(d =>
    `<option value="${d.numericId}">[ID: ${d.numericId}] ${d.name} (${d.on ? 'ON' : 'OFF'} - ${Math.round((d.bri/254)*100)}%)</option>`
  ).join('');
}

function renderAlexaTable(devices) {
  const tbody = document.getElementById('alexa-devices-tbody');
  if (!tbody) return;

  if (!devices || devices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="padding:16px;text-align:center;color:var(--text-muted)">No devices exposed to Alexa</td></tr>';
    return;
  }

  tbody.innerHTML = devices.map(d => `
    <tr style="border-bottom:1px solid var(--border-color)">
      <td style="padding:10px 14px;color:var(--accent-cyan);font-weight:600">${d.numericId}</td>
      <td style="padding:10px 14px;font-weight:500;color:#fff">${escapeHtml(d.name)}</td>
      <td style="padding:10px 14px;color:var(--text-muted);font-size:12px">${d.type}</td>
      <td style="padding:10px 14px">
        <span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:${d.on ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'};color:${d.on ? 'var(--accent-emerald)' : '#f87171'}">
          ${d.on ? 'ON' : 'OFF'}
        </span>
      </td>
      <td style="padding:10px 14px;color:var(--text-muted)">${Math.round((d.bri / 254) * 100)}%</td>
      <td style="padding:10px 14px;text-align:right">
        <button class="btn-secondary" style="padding:4px 8px;font-size:11px" onclick="quickToggleAlexa('${d.numericId}', ${!d.on})">
          ${d.on ? 'Turn Off' : 'Turn On'}
        </button>
      </td>
    </tr>
  `).join('');
}

function filterAlexaDevices(term) {
  const query = (term || '').toLowerCase().trim();
  if (!query) {
    renderAlexaTable(alexaCachedDevices);
    return;
  }
  const filtered = alexaCachedDevices.filter(d =>
    d.name.toLowerCase().includes(query) || d.numericId.includes(query) || d.type.toLowerCase().includes(query)
  );
  renderAlexaTable(filtered);
}

async function simulateAlexaCommand(power) {
  const select = document.getElementById('alexa-sim-device');
  const id = select ? select.value : null;
  if (!id) return alert('Please select a device to simulate voice command.');

  const resultEl = document.getElementById('alexa-sim-result');
  try {
    const res = await fetch(`/api/alexa/lights/${id}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: power })
    });
    const data = await res.json();
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.style.color = 'var(--accent-emerald)';
      resultEl.textContent = `[Alexa Emulation Success] PUT /api/alexa/lights/${id}/state -> ` + JSON.stringify(data);
    }
    loadAlexaStatus();
  } catch (err) {
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.style.color = '#f87171';
      resultEl.textContent = `[Alexa Emulation Error] ` + err.message;
    }
  }
}

async function simulateAlexaDim() {
  const select = document.getElementById('alexa-sim-device');
  const id = select ? select.value : null;
  const bri = parseInt(document.getElementById('alexa-sim-bri').value) || 128;
  if (!id) return alert('Please select a device.');

  const resultEl = document.getElementById('alexa-sim-result');
  try {
    const res = await fetch(`/api/alexa/lights/${id}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: true, bri })
    });
    const data = await res.json();
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.style.color = 'var(--accent-emerald)';
      resultEl.textContent = `[Alexa Emulation Success] PUT /api/alexa/lights/${id}/state -> ` + JSON.stringify(data);
    }
    loadAlexaStatus();
  } catch (err) {
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.style.color = '#f87171';
      resultEl.textContent = `[Alexa Emulation Error] ` + err.message;
    }
  }
}

async function quickToggleAlexa(id, power) {
  try {
    await fetch(`/api/alexa/lights/${id}/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: power })
    });
    loadAlexaStatus();
  } catch (e) {
    console.error('Quick toggle error:', e);
  }
}
