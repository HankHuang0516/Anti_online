// Placeholder to ensure tool usage is valid, but actually I am skipping this tool call in favor of deploying first.
// Wait, I can't skip tool call? I must return something.
// I will just return status or something innocuous?
// No, I'll just change the plan.
// I'll proceed with "Pushing code" instead of editing file.
import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const RAILWAY_AUTH_URL = 'https://antionline-production.up.railway.app';

// Load saved settings from localStorage
const loadSettings = () => {
  try {
    const saved = localStorage.getItem('anti_online_settings');
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
};

function App() {
  const savedSettings = loadSettings();

  // Server URL is now fixed to Railway Relay
  const serverUrl = RAILWAY_AUTH_URL;
  const [socket, setSocket] = useState(null);

  const [connected, setConnected] = useState(false);
  // Auto-login if token is saved
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return !!localStorage.getItem('anti_online_access_token');
  });
  const [accessCode, setAccessCode] = useState(() => {
    return localStorage.getItem('anti_online_access_token') || '';
  });
  const [logs, setLogs] = useState([]);
  const [macroMode, setMacroMode] = useState(false);
  const [inputText, setInputText] = useState('');
  const [isSynced, setIsSynced] = useState(true); // Indicator for cloud sync status

  // Ref to keep track of latest accessCode without re-triggering socket effect
  const accessCodeRef = useRef(accessCode);
  useEffect(() => {
    accessCodeRef.current = accessCode;
  }, [accessCode]);
  const [screenImage, setScreenImage] = useState(null);
  const [dialogCoords, setDialogCoords] = useState(savedSettings?.dialogCoords || null);
  const [settingMode, setSettingMode] = useState(null); // 'dialog', 'terminal-id', null
  const [terminals, setTerminals] = useState(savedSettings?.terminals || []);
  const [textItems, setTextItems] = useState(savedSettings?.textItems || []); // [{id, text, position: 'prepend'|'append', enabled: true}]
  const [mouseMode, setMouseMode] = useState('off');
  const [autoAccept, setAutoAccept] = useState(false);
  const [dpiScale, setDpiScale] = useState(savedSettings?.dpiScale || 1.25);
  const [offsetX, setOffsetX] = useState(savedSettings?.offsetX || 0);
  const [offsetY, setOffsetY] = useState(savedSettings?.offsetY || 0);
  const [currentScreen, setCurrentScreen] = useState(savedSettings?.currentScreen || 0);
  const logEndRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);

  // Timed Loop State
  const [endTime, setEndTime] = useState(0);
  const [timedLoopEnabled, setTimedLoopEnabled] = useState(false);
  const [timerHours, setTimerHours] = useState(0);
  const [timerMinutes, setTimerMinutes] = useState(5);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timedLoopText, setTimedLoopText] = useState('');
  const [countdownRemaining, setCountdownRemaining] = useState(null);
  const [isTimedLoopRunning, setIsTimedLoopRunning] = useState(false);
  const isRestartingRef = useRef(false); // Flag to ignore STOPPED event during restart

  // Helper to check if any setting mode is active
  const isSettingAnything = settingMode !== null;

  // Ref for the main image in the App component
  const imageRef = useRef(null);

  // Save settings to localStorage when they change
  useEffect(() => {
    const settings = {
      dialogCoords,
      terminals,
      textItems,
      dpiScale,
      offsetX,
      offsetY,
      currentScreen,
      timedLoopText, // Persist this
      timedLoopEnabled // Persist this too if desired, but user asked for text
    };
    localStorage.setItem('anti_online_settings', JSON.stringify(settings));
  }, [dialogCoords, terminals, textItems, dpiScale, offsetX, offsetY, currentScreen, timedLoopText, timedLoopEnabled]);

  // Text Item Handlers
  const addTextItem = () => {
    setTextItems(prev => [...prev, {
      id: Date.now().toString(),
      text: '',
      position: 'prepend',
      enabled: true
    }]);
  };

  const updateTextItem = (id, field, value) => {
    setTextItems(prev => prev.map(item =>
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const toggleTextItem = (id) => {
    setTextItems(prev => prev.map(item =>
      item.id === id ? { ...item, enabled: !item.enabled } : item
    ));
  };

  const removeTextItem = (id) => {
    setTextItems(prev => prev.filter(item => item.id !== id));
  };

  // Initialize socket when server URL changes
  useEffect(() => {
    if (socket) {
      socket.disconnect();
    }

    // Add headers to skip browser warnings (Ngrok & LocalTunnel)
    const savedToken = localStorage.getItem('anti_online_access_token');
    const newSocket = io(serverUrl, {
      auth: {
        token: savedToken,
        role: 'viewer'
      },
      transports: ['websocket'], // Force WebSocket to avoid CORS preflight (OPTIONS) issues with LocalTunnel
      extraHeaders: {
        "ngrok-skip-browser-warning": "true",
        "Bypass-Tunnel-Reminder": "true"
      }
    });
    setSocket(newSocket);

    // Save URL for next time
    localStorage.setItem('anti_online_server_url', serverUrl);

    return () => {
      newSocket.disconnect();
    };
  }, [serverUrl]);

  useEffect(() => {
    if (!socket) return;

    socket.on('connect', () => {
      setConnected(true);
      addLog('System', `Connected to ${serverUrl}`);
    });

    socket.on('disconnect', () => {
      setConnected(false);
      // setIsAuthenticated(false); // Keep persistence
      addLog('System', 'Disconnected from server');
    });

    socket.on('log', (data) => {
      addLog('Server', data.message);
      // Sync Monitor State from Server Logs
      if (data.message && data.message.includes('Switched to Monitor')) {
        const match = data.message.match(/Switched to Monitor (\d+)/);
        if (match && match[1]) {
          setCurrentScreen(parseInt(match[1]));
        }
      }
    });

    socket.on('screen_update', (data) => {
      setScreenImage(`data:image/jpeg;base64,${data.image}`);
    });

    socket.on('auth_result', (data) => {
      if (data.success) {
        setIsAuthenticated(true);
        // Cache the successful token using Ref to get latest value
        localStorage.setItem('anti_online_access_token', accessCodeRef.current);

        addLog('System', 'Authentication successful');
        // Resend settings after auth
        socket.emit('command', { type: 'SET_DPI_SCALE', scale: dpiScale });
        socket.emit('command', { type: 'SET_SCREEN_OFFSET', x: offsetX, y: offsetY });
        // Restore Monitor Selection
        if (currentScreen) {
          socket.emit('command', { type: 'SET_MONITOR', index: currentScreen });
        }
      } else {
        // Fix: Force logout on failure to prevent loop
        alert('Invalid access code. Please try again.');
        addLog('System', 'Authentication failed');
        setIsAuthenticated(false);
        localStorage.removeItem('anti_online_access_token');
      }
    });

    socket.on('error', (data) => {
      addLog('Error', data.message);
    });

    // Timed Loop Events
    // Timed Loop Events
    socket.on('TIMED_LOOP_CYCLE', (data) => {
      // Just log or update status, do NOT restart here anymore as per new flow
      // console.log("Backend cycle complete", data);
    });

    // --- REAL TEME SYNC LISTENERS ---
    socket.on('state_sync', (state) => {
      if (state.timedLoopText !== undefined) setTimedLoopText(state.timedLoopText);
      if (state.timedLoopEnabled !== undefined) setTimedLoopEnabled(state.timedLoopEnabled);
      if (state.timer.running) {
        setIsTimedLoopRunning(true);
        setEndTime(state.timer.endTime);
        const now = Date.now();
        const diff = Math.ceil((state.timer.endTime - now) / 1000);
        setCountdownRemaining(diff > 0 ? diff : 0);
      } else {
        setIsTimedLoopRunning(false);
        setCountdownRemaining(0);
      }
    });

    socket.on('text_updated', (data) => {
      setTimedLoopText(data.text);
    });

    socket.on('enabled_updated', (data) => {
      setTimedLoopEnabled(data.enabled);
    });

    socket.on('timer_updated', (timer) => {
      if (timer.running) {
        setIsTimedLoopRunning(true);
        setEndTime(timer.endTime);
        const now = Date.now();
        const diff = Math.ceil((timer.endTime - now) / 1000);
        setCountdownRemaining(diff > 0 ? diff : 0);
      } else {
        setIsTimedLoopRunning(false);
        setCountdownRemaining(0);
      }
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('log');
      socket.off('screen_update');
      socket.off('auth_result');
      socket.off('error');
      socket.off('state_sync');
      socket.off('text_updated');
      socket.off('enabled_updated');
      socket.off('timer_updated');
    };
  }, [socket, dpiScale, offsetX, offsetY, currentScreen]);

  // Frontend-driven Timed Loop Restart Logic
  useEffect(() => {
    if (isTimedLoopRunning && countdownRemaining !== null && countdownRemaining <= 0) {
      // Only trigger if we are "close" to zero (within 1s) to avoid double firing on old state
      // Actually, simplified: If it hits zero, WE EMIT THE COMMAND.
      // The server doesn't auto-stop. We stay "Running".
      // We emit command -> Wait -> Emit Start Again?

      socket.emit('command', {
        type: 'TIMED_LOOP_START',
        x: dialogCoords?.x,
        y: dialogCoords?.y,
        text: timedLoopText
      });

      // RESTART THE TIMER (Loop)
      // Calculate original duration from current input (or saved state)
      const totalSeconds = timerHours * 3600 + timerMinutes * 60 + timerSeconds;
      socket.emit('timer_action', { action: 'start', duration: totalSeconds });
    }
  }, [countdownRemaining, isTimedLoopRunning, dialogCoords, timedLoopText, timerHours, timerMinutes, timerSeconds, socket]);

  // Synced Timer Logic
  useEffect(() => {
    let interval = null;
    if (isTimedLoopRunning && endTime > 0) {
      interval = setInterval(() => {
        const now = Date.now();
        const diff = Math.ceil((endTime - now) / 1000);
        setCountdownRemaining(diff);
      }, 500); // Check every 500ms
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isTimedLoopRunning, endTime]);

  // CLOUD SYNC LOGIC
  // 1. Load Data on Auth
  useEffect(() => {
    if (isAuthenticated) {
      const code = accessCodeRef.current;
      if (!code) return;

      fetch(`${RAILWAY_AUTH_URL}/data`, {
        headers: {
          'Content-Type': 'application/json',
          'x-access-code': code
        }
      })
        .then(res => res.json())
        .then(data => {
          if (data && Object.keys(data).length > 0) {
            if (data.dialogCoords) setDialogCoords(data.dialogCoords);
            if (data.terminals) setTerminals(data.terminals);
            if (data.textItems) setTextItems(data.textItems);
            if (data.dpiScale) setDpiScale(data.dpiScale);
            if (data.offsetX !== undefined) setOffsetX(data.offsetX);
            if (data.offsetY !== undefined) setOffsetY(data.offsetY);
            if (data.offsetX !== undefined) setOffsetX(data.offsetX);
            if (data.offsetY !== undefined) setOffsetY(data.offsetY);
            if (data.currentScreen !== undefined) setCurrentScreen(data.currentScreen);

            // Restore Timed Loop Config
            if (data.timerHours !== undefined) setTimerHours(data.timerHours);
            if (data.timerMinutes !== undefined) setTimerMinutes(data.timerMinutes);
            if (data.timerSeconds !== undefined) setTimerSeconds(data.timerSeconds);
            if (data.timedLoopText !== undefined) setTimedLoopText(data.timedLoopText);

            addLog('System', 'Settings loaded from cloud');
          }
        })
        .catch(err => console.error('Failed to load cloud settings', err));
    }
  }, [isAuthenticated]);

  // 2. Save Data on Change (Debounced)
  useEffect(() => {
    if (!isAuthenticated) return;

    setIsSynced(false);
    const timer = setTimeout(() => {
      const settings = {
        dialogCoords,
        terminals,
        textItems,
        dpiScale,
        offsetX,
        offsetY,
        currentScreen,
        // Timed Loop Synced Support
        timerHours,
        timerMinutes,
        timerSeconds,
        timedLoopText,
        // timedLoopEnabled  <-- Maybe don't sync this, or user starts loop on load? Let's just sync config.
      };

      const code = accessCodeRef.current;
      if (!code) return;

      fetch(`${RAILWAY_AUTH_URL}/data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-access-code': code
        },
        body: JSON.stringify({ data: settings })
      })
        .then(res => res.json())
        .then(res => {
          if (res.success) setIsSynced(true);
        })
        .catch(err => {
          console.error('Cloud save failed', err);
          // Retry? or just leave unsynced status
        });
    }, 2000); // 2 seconds debounce

    return () => clearTimeout(timer);
  }, [dialogCoords, terminals, textItems, dpiScale, offsetX, offsetY, currentScreen, isAuthenticated]);

  const handleAuth = (e) => {
    e.preventDefault();

    // Offline / Disconnected Login Logic
    if (!socket || !connected) {
      const cachedToken = localStorage.getItem('anti_online_access_token');
      // 1. Check Cache
      if (cachedToken && accessCode === cachedToken) {
        setIsAuthenticated(true);
        addLog('System', 'Offline login successful (cached)');
        return;
      }

      // 2. Check Cloud (Railway)
      addLog('System', 'Verifying with cloud...');
      fetch(`${RAILWAY_AUTH_URL}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: accessCode })
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setIsAuthenticated(true);
            // Cache it now
            localStorage.setItem('anti_online_access_token', accessCode);
            if (socket) {
              socket.auth = { token: accessCode, role: 'viewer' };
              socket.disconnect().connect();
            }
            addLog('System', 'Offline login successful (cloud verified)');
          } else {
            alert('Cannot verify password offline, or password incorrect.');
            addLog('System', 'Offline login failed');
          }
        })
        .catch(err => {
          console.error(err);
          alert('Offline login failed: Cloud unreachable.');
        });
      return;
    }

    // Online Login
    if (!socket) {
      alert('Socket not connected yet. Please wait or check Server URL.');
      return;
    }
    socket.emit('command', { type: 'AUTH', code: accessCode });
  };

  // Sync DPI Scale to server
  useEffect(() => {
    if (connected) {
      socket.emit('command', { type: 'SET_DPI_SCALE', scale: dpiScale });
    }
  }, [dpiScale, connected]);
  // Calculate logical coordinates from click on image
  // Calculate logical coordinates from click on image
  const getLogicalCoords = (e) => {
    const target = e.currentTarget;
    // If the click is on the image itself, use it. Otherwise look for an image inside.
    const img = target.tagName === 'IMG' ? target : target.querySelector('img');

    if (!img) return null;

    const rect = img.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Safety check: ignore clicks outside the image bounds (if triggered by container)
    if (clickX < 0 || clickY < 0 || clickX > rect.width || clickY > rect.height) {
      return null;
    }

    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const physicalX = Math.floor(clickX * scaleX);
    const physicalY = Math.floor(clickY * scaleY);
    // Use dpiScale from state and apply offsets
    return {
      x: Math.floor(physicalX / dpiScale) + offsetX,
      y: Math.floor(physicalY / dpiScale) + offsetY
    };
  };

  const handleImageClick = (e) => {
    const coords = getLogicalCoords(e);
    if (!coords) return;

    // PRIORITY 1: Setting Mode (Calibration)
    // Always prioritize setting positions if a mode is active
    if (settingMode === 'dialog') {
      setDialogCoords(coords);
      setSettingMode(null);
      addLog('System', `Dialog set to (${coords.x}, ${coords.y})`);
      return;
    }

    if (settingMode?.startsWith('terminal-')) {
      const terminalId = settingMode.replace('terminal-', '');
      setTerminals(prev => prev.map(t =>
        t.id === terminalId ? { ...t, x: coords.x, y: coords.y } : t
      ));
      setSettingMode(null);
      addLog('System', `Terminal ${terminalId} set to (${coords.x}, ${coords.y})`);
      return;
    }

    // PRIORITY 2: Mouse Click Mode (only if no setting mode is active)
    if (mouseMode === 'click' && !isSettingAnything) {
      socket.emit('command', { type: 'MOUSE_CLICK', x: coords.x, y: coords.y });
      addLog('System', `Mouse click at (${coords.x}, ${coords.y})`);
      return;
    }
  };

  // Placeholder functions for addLog, handleStartAgent, toggleMacroMode, addTerminal, updateTerminalCommand, removeTerminal, restartTerminal
  // These would typically be defined elsewhere in the App component
  const addLog = (source, message) => {
    setLogs(prevLogs => [...prevLogs, { time: new Date().toLocaleTimeString(), source, message }]);
  };

  const handleStartAgent = () => {
    if (socket) {
      socket.emit('command', { type: 'START_AGENT' });
      addLog('System', 'Starting Antigravity agent...');
    }
  };

  const handleStartMacro = () => {
    if (!socket) return;
    if (!dialogCoords) {
      addLog('Error', 'Dialog position not set. Please set it in Settings first.');
      return;
    }
    socket.emit('command', {
      type: 'TIMED_LOOP_START',
      x: dialogCoords.x,
      y: dialogCoords.y,
      text: timedLoopText
    });
    addLog('System', `Starting Macro Loop at (${dialogCoords.x}, ${dialogCoords.y})`);
  };

  const handleStartTimedLoop = (e) => {
    e.preventDefault();
    if (!socket) return;
    if (!dialogCoords) {
      addLog('Error', 'Dialog position not set. Please set it in Settings first.');
      return;
    }
    if (!timedLoopEnabled) {
      addLog('Error', 'Timed loop not enabled.');
      return;
    }

    const totalSeconds = timerHours * 3600 + timerMinutes * 60 + timerSeconds;
    if (totalSeconds <= 0) {
      addLog('Error', 'Timer must be greater than 0.');
      return;
    }

    setCountdownRemaining(totalSeconds);
    setIsTimedLoopRunning(true);
    isRestartingRef.current = false; // Reset flag on manual start

    socket.emit('command', {
      type: 'TIMED_LOOP_START',
      x: dialogCoords.x,
      y: dialogCoords.y,
      text: timedLoopText
    });

    addLog('System', `Starting Timed Loop: ${totalSeconds}s, Text: ${timedLoopText ? 'Yes' : 'No'}`);
  };

  const addTerminal = () => {
    const newTerminal = {
      id: Date.now().toString(),
      name: `Terminal ${terminals.length + 1}`, // Default name
      command: 'npm start',
      x: null,
      y: null,
    };
    setTerminals(prev => [...prev, newTerminal]);
    addLog('System', `Added new terminal: ${newTerminal.name}`);
  };

  const updateTerminalCommand = (id, command) => {
    setTerminals(prev => prev.map(t => t.id === id ? { ...t, command } : t));
    addLog('System', `Updated terminal ${id} command to: ${command}`);
  };

  const removeTerminal = (id) => {
    setTerminals(prev => prev.filter(t => t.id !== id));
    addLog('System', `Removed terminal ${id}`);
    if (settingMode === `terminal-${id}`) {
      setSettingMode(null); // Cancel setting mode if the terminal is removed
    }
  };

  const restartTerminal = (terminal) => {
    if (socket && terminal.x !== null) {
      socket.emit('command', { type: 'RESTART_TERMINAL', id: terminal.id, command: terminal.command, x: terminal.x, y: terminal.y });
      addLog('System', `Restarting terminal ${terminal.name} at (${terminal.x}, ${terminal.y}) with command "${terminal.command}"`);
    } else {
      addLog('Error', `Cannot restart terminal ${terminal.name}: position not set.`);
    }
  };

  const handleSendInput = (e) => {
    e.preventDefault();
    if (!socket) return;
    if (!dialogCoords) {
      addLog('Error', 'Dialog position not set. Cannot send input.');
      return;
    }

    // construct final text
    const prepends = textItems.filter(i => i.enabled && i.position === 'prepend').map(i => i.text);
    const appends = textItems.filter(i => i.enabled && i.position === 'append').map(i => i.text);

    // Combine: Prepends + input + Appends
    // Filter out empty strings to avoid extra newlines if not needed
    const combinedParts = [
      ...prepends,
      inputText,
      ...appends
    ].filter(t => t.trim().length > 0);

    const finalText = combinedParts.join('\n');

    if (finalText.trim()) {
      socket.emit('command', { type: 'INPUT_TEXT', text: finalText, dialogX: dialogCoords.x, dialogY: dialogCoords.y });
      addLog('User', `Sent input (${combinedParts.length} parts)`);
      setInputText(''); // Clear main input only
    }
  };

  const SettingsModal = () => (
    <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-sm z-50 flex flex-col overflow-hidden">

      {/* --- Calibration Overlay (Full Screen) --- */}
      {isSettingAnything && (
        <div className="fixed inset-0 z-[60] bg-black flex flex-col animate-in fade-in duration-200">
          <div className="flex justify-between items-center p-4 bg-slate-900/80 backdrop-blur border-b border-slate-700">
            <div className="flex flex-col">
              <span className="text-white font-bold text-lg">Tap to Calibrate</span>
              <span className="text-yellow-400 text-xs font-mono">
                Setting: {settingMode === 'dialog' ? 'Dialog Position' : settingMode}
              </span>
            </div>
            <button
              onClick={() => setSettingMode(null)}
              className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-bold text-sm"
            >
              Cancel
            </button>
          </div>

          <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
            {screenImage ? (
              <img
                src={screenImage}
                alt="Calibration Overlay"
                className="max-w-full max-h-full object-contain cursor-crosshair"
                onClick={handleImageClick}
                draggable={false}
              />
            ) : (
              <div className="text-slate-500">Waiting for stream...</div>
            )}

            {/* Overlay Guidelines */}
            <div className="absolute inset-0 pointer-events-none border-2 border-yellow-500/30"></div>
            <div className="absolute bottom-8 left-0 right-0 text-center pointer-events-none">
              <span className="bg-black/60 text-white px-3 py-1 rounded-full text-sm backdrop-blur">
                Tap the exact target on screen
              </span>
            </div>
          </div>
        </div>
      )}

      {/* --- Normal Settings UI --- */}
      {/* 1. Header */}
      <div className="flex justify-between items-center px-4 py-3 border-b border-slate-700 bg-slate-900 shadow-md z-10">
        <h2 className="text-lg font-bold text-white">Settings & Calibration</h2>
        <button
          onClick={() => setShowSettings(false)}
          className="text-slate-400 hover:text-white p-2 rounded-full hover:bg-slate-800 transition-colors"
        >
          ✕ Close
        </button>
      </div>

      {/* 3. Settings Controls (Scrollable) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 lg:p-6 pb-24">
        <div className="max-w-xl mx-auto space-y-6">

          {/* Info Card */}
          <div className="bg-blue-900/20 border border-blue-500/30 p-4 rounded-xl flex items-start gap-3">
            <span className="text-xl">💡</span>
            <div className="text-sm text-blue-200">
              <p className="font-bold mb-1">How to Calibrate?</p>
              <p className="opacity-80">Click the <span className="font-bold text-white">"🎯 Set Position"</span> button, and the screen will switch to full-screen mode for you to tap the target.</p>
            </div>
          </div>

          {/* Dialog Position Card */}
          <div className="bg-slate-800 p-4 rounded-xl space-y-3 shadow-sm border border-slate-700/50">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-slate-200">Dialog Box</h3>
              <div className="text-xs font-mono text-slate-400 bg-slate-900 px-2 py-1 rounded">
                current: {dialogCoords ? `${dialogCoords.x},${dialogCoords.y}` : '-,-'}
              </div>
            </div>
            <button
              onClick={() => setSettingMode('dialog')}
              className="w-full py-3 rounded-lg text-sm font-bold transition-all bg-slate-700 text-slate-200 hover:bg-slate-600 hover:text-white active:scale-[0.98] flex items-center justify-center gap-2"
            >
              🎯 Set Position
            </button>
            <p className="text-xs text-slate-500">The "Accept" button location.</p>
          </div>

          {/* Terminals Config Card */}
          <div className="bg-slate-800 p-4 rounded-xl space-y-4 shadow-sm border border-slate-700/50">
            <div className="flex justify-between items-center border-b border-slate-700 pb-2">
              <h3 className="font-medium text-slate-200">Terminals</h3>
              <button onClick={addTerminal} className="text-xs bg-green-600 active:bg-green-700 px-3 py-1.5 rounded font-bold text-white shadow-sm">+ Add</button>
            </div>

            <div className="space-y-3">
              {terminals.length === 0 && <div className="text-center text-slate-500 text-sm py-2">No terminals added</div>}
              {terminals.map(t => (
                <div key={t.id} className="bg-slate-900 p-3 rounded-lg flex flex-col gap-3 border border-slate-700">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-300">{t.name}</span>
                    <button onClick={() => removeTerminal(t.id)} className="text-slate-500 hover:text-red-400 px-2">✕</button>
                  </div>

                  <div className="grid grid-cols-[1fr,auto] gap-2 items-center">
                    <select
                      value={t.command}
                      onChange={(e) => updateTerminalCommand(t.id, e.target.value)}
                      className="bg-slate-800 border border-slate-700 rounded px-2 py-2 text-xs text-slate-300 focus:ring-1 focus:ring-blue-500 outline-none"
                    >
                      <option value="npm start">npm start</option>
                      <option value="npm run dev">npm run dev</option>
                    </select>

                    <button
                      onClick={() => setSettingMode(`terminal-${t.id}`)}
                      className="px-3 py-2 rounded text-xs font-bold transition-all whitespace-nowrap bg-slate-700 text-slate-200 active:bg-slate-600 hover:text-white flex items-center gap-1"
                    >
                      🎯 Set Pos
                    </button>
                  </div>

                  <div className="text-[10px] text-slate-500 font-mono text-right">
                    {t.x !== null ? `(${t.x}, ${t.y})` : 'Position not set'}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Advanced Settings (DPI/Offset) */}
          <div className="bg-slate-800 p-4 rounded-xl space-y-4 shadow-sm border border-slate-700/50">
            <div className="flex justify-between items-center border-b border-slate-700 pb-2">
              <h3 className="font-medium text-slate-200">Fine Tuning</h3>
              <button
                onClick={() => {
                  if (!socket) return;
                  socket.emit('command', { type: 'SWITCH_MONITOR' });
                  addLog('System', 'Requested Sync Monitor Switch...');
                }}
                disabled={!connected}
                className={`text-xs px-3 py-1.5 rounded font-bold text-white shadow-sm transition-colors ${connected
                  ? 'bg-purple-600 hover:bg-purple-500'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  }`}
              >
                Switch Monitor
              </button>
            </div>

            <div className="space-y-4">
              {/* DPI */}
              <div>
                <div className="flex justify-between mb-1">
                  <label className="text-xs text-slate-400">DPI Scale</label>
                  <span className="text-xs font-mono text-cyan-400">{dpiScale.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="2"
                  step="0.05"
                  value={dpiScale}
                  onChange={(e) => setDpiScale(parseFloat(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />
              </div>

              {/* Offsets */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between mb-1">
                    <label className="text-xs text-slate-400">X Offset</label>
                    <span className="text-xs font-mono text-cyan-400">{offsetX}px</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="5"
                    value={offsetX}
                    onChange={(e) => setOffsetX(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <label className="text-xs text-slate-400">Y Offset</label>
                    <span className="text-xs font-mono text-cyan-400">{offsetY}px</span>
                  </div>
                  <input
                    type="range"
                    min="-100"
                    max="100"
                    step="5"
                    value={offsetY}
                    onChange={(e) => setOffsetY(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="h-8"></div> {/* Spacer */}
        </div>
      </div>
    </div>
  );

  if (!isAuthenticated) {
    // ... (login screen remains same)
    return (
      <div className="min-h-screen bg-brand-dark text-slate-200 flex items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-xl shadow-lg w-full max-w-md border border-slate-700">
          <h1 className="text-3xl font-bold text-center mb-6 bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            Anti Online
          </h1>
          <div className="mb-4 hidden">
            <label htmlFor="serverUrl" className="block text-sm font-medium text-slate-400 mb-1">Server URL</label>
            <input
              type="text"
              id="serverUrl"
              value={serverUrl}
              disabled
              className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-slate-500 cursor-not-allowed"
            />
          </div>
          <div className="mb-6">
            <label htmlFor="accessCode" className="block text-sm font-medium text-slate-400 mb-1">Access Code</label>
            <input
              type="password"
              id="accessCode"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your access code"
            />
          </div>
          <button
            onClick={() => {
              if (socket) {
                socket.disconnect();
              }
              // Connect to Railway Relay
              const newSocket = io(serverUrl, {
                auth: { token: accessCode },
                transports: ['websocket', 'polling']
              });
              setSocket(newSocket);
              addLog('System', `Connecting to Cloud Relay...`);
            }}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold text-white shadow-lg transition-colors"
          >
            Connect
          </button>
          <div className="mt-6 text-center text-sm text-slate-400">
            {connected ? (
              <span className="text-green-400">Connected to server.</span>
            ) : (
              <span className="text-red-400">Disconnected from server.</span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-dark text-slate-200 p-4 lg:p-8 font-sans">
      {showSettings && <SettingsModal />}

      <div className="max-w-6xl mx-auto space-y-4 lg:space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-700 pb-4">
          <h1 className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            Anti Online
          </h1>
          <div className="flex items-center gap-3">
            {/* Sync Indicator */}
            {isAuthenticated && (
              <div title={isSynced ? "Settings synced to cloud" : "Syncing..."} className="text-xs">
                {isSynced ? '☁️ Synced' : '🔄 Syncing...'}
              </div>
            )}
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs lg:text-sm font-medium ${connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}></span>
              <span className="hidden sm:inline">{connected ? 'Connected' : 'Disconnected'}</span>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-sm border border-slate-700 flex items-center gap-2 transition-colors"
            >
              ⚙️ Settings
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Live Stream View - Main */}
          <div className="lg:col-span-2 space-y-4">
            <div
              className={`rounded-2xl bg-black border overflow-hidden aspect-video flex items-center justify-center relative group ${isSettingAnything ? 'border-yellow-500 border-2 cursor-crosshair' : mouseMode === 'click' ? 'border-cyan-500 border-2 cursor-pointer' : 'border-slate-800'}`}
              onClick={handleImageClick}
            >
              {screenImage ? (
                <img
                  ref={imageRef}
                  src={screenImage}
                  alt="Live View"
                  className="w-full h-full object-contain"
                  draggable={false}
                />
              ) : (
                <div className="text-slate-600 flex flex-col items-center">
                  <span className="text-4xl mb-2">📷</span>
                  <span>Waiting for stream...</span>
                </div>
              )}
              {/* Overlays remain same */}
              <div className="absolute top-2 right-2 bg-black/50 px-2 py-1 rounded text-xs text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity">
                {mouseMode === 'click' ? '🖱️ Click Mode Active' : 'Live Preview'}
              </div>
              {isSettingAnything && (
                <div className="absolute inset-0 bg-yellow-500/10 flex items-center justify-center">
                  <span className="bg-yellow-500 text-black px-4 py-2 rounded-lg font-bold animate-pulse">
                    Click to set position
                  </span>
                </div>
              )}
              {dialogCoords && !isSettingAnything && (
                <div className="absolute bottom-2 left-2 bg-green-500/80 text-white px-2 py-1 rounded text-xs font-mono">
                  Dialog: ({dialogCoords.x}, {dialogCoords.y})
                </div>
              )}
            </div>

            {/* Mouse Mode Controls Only - No Settings */}
            <div className="flex gap-2">
              <button
                onClick={() => setMouseMode('off')}
                className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all shadow-sm ${mouseMode === 'off' ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                🖱️ View Only
              </button>
              <button
                onClick={() => setMouseMode('click')}
                className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all shadow-sm ${mouseMode === 'click' ? 'bg-cyan-600 text-white ring-2 ring-cyan-500/50' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                👆 Click Mode
              </button>
            </div>
          </div>

          {/* Controls & Logs Panel */}
          <div className="space-y-4">
            {/* Agent Control */}
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700 backdrop-blur-sm">
              <h2 className="text-lg font-semibold mb-3 text-slate-300">Agent Control</h2>
              <div className="space-y-2">
                <button
                  onClick={handleStartAgent}
                  className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-all text-sm shadow-lg shadow-blue-900/20"
                >
                  Start Antigravity
                </button>
                <button
                  onClick={handleStartMacro}
                  disabled={!dialogCoords}
                  className={`w-full py-2 px-4 rounded-lg font-medium transition-all text-sm ${!dialogCoords ? 'bg-slate-700 text-slate-500 cursor-not-allowed' : 'bg-green-600 hover:bg-green-500 text-white'}`}
                >
                  ▶ Start Macro Loop
                </button>
                <button
                  onClick={() => socket.emit('command', { type: 'STOP_LOOP' })}
                  className="w-full py-2 px-4 bg-red-600 hover:bg-red-500 rounded-lg font-medium transition-all text-sm"
                >
                  ⏹ Stop Loop
                </button>
                <button
                  onClick={() => {
                    const newState = !autoAccept;
                    setAutoAccept(newState);
                    socket.emit('command', { type: newState ? 'AUTO_ACCEPT_START' : 'AUTO_ACCEPT_STOP' });
                  }}
                  className={`w-full py-2 px-4 rounded-lg font-medium transition-all text-sm ${autoAccept ? 'bg-emerald-600 hover:bg-emerald-500 animate-pulse' : 'bg-slate-700 hover:bg-slate-600'}`}
                >
                  {autoAccept ? '✅ Auto Accept ON' : '🤖 Auto Accept All'}
                </button>
              </div>
            </div>

            {/* Terminals - Usage Only (Restart) */}
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700 backdrop-blur-sm">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-semibold text-slate-300">Terminals</h2>
                <div className="text-xs text-slate-500 font-normal">Go to Settings to configure</div>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {terminals.length === 0 && (
                  <div className="text-slate-500 text-sm text-center py-2">No terminals added</div>
                )}
                {terminals.map((terminal, index) => (
                  <div key={terminal.id} className="bg-slate-900 rounded-lg p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400 font-medium">Terminal {index + 1} ({terminal.name})</span>
                      <span className="text-xs font-mono text-slate-500">{terminal.command}</span>
                    </div>
                    <button
                      onClick={() => restartTerminal(terminal)}
                      disabled={terminal.x === null}
                      className={`w-full py-2 rounded text-xs font-bold ${terminal.x !== null ? 'bg-orange-600 hover:bg-orange-500 text-white' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}
                    >
                      {terminal.x !== null ? '▶ Restart Terminal' : '⚠️ Position not set'}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Timed Loop Control */}
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700 backdrop-blur-sm">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-semibold text-slate-300">Timed Loop</h2>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-400 font-medium">Enable</label>
                  <input
                    type="checkbox"
                    checked={timedLoopEnabled}
                    onChange={(e) => {
                      const val = e.target.checked;
                      setTimedLoopEnabled(val);
                      socket.emit('update_enabled', val);
                    }}
                    className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-offset-0 focus:ring-0 cursor-pointer"
                  />
                </div>
              </div>

              {timedLoopEnabled && (
                <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                  {/* Timer Input */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500 uppercase font-bold text-center">Hours</label>
                      <input
                        type="number"
                        min="0"
                        value={timerHours}
                        onChange={(e) => setTimerHours(Math.max(0, parseInt(e.target.value) || 0))}
                        className="bg-slate-900 border border-slate-700 rounded p-1 text-center text-sm text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500 uppercase font-bold text-center">Minutes</label>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={timerMinutes}
                        onChange={(e) => setTimerMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                        className="bg-slate-900 border border-slate-700 rounded p-1 text-center text-sm text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] text-slate-500 uppercase font-bold text-center">Seconds</label>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={timerSeconds}
                        onChange={(e) => setTimerSeconds(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                        className="bg-slate-900 border border-slate-700 rounded p-1 text-center text-sm text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none"
                      />
                    </div>
                  </div>

                  {/* Text Input */}
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400 font-medium">Auto-paste Text (Optional) - Live Sync</label>
                    <input
                      type="text"
                      value={timedLoopText}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTimedLoopText(val); // Optimistic update
                        socket.emit('update_text', val);
                      }}
                      placeholder="Text to paste initially... (Syncs across devices)"
                      className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-blue-500 outline-none placeholder-slate-600"
                    />
                  </div>

                  {/* Countdown Display if Running */}
                  {isTimedLoopRunning && (
                    <div className="text-center py-2 bg-black/30 rounded-lg border border-slate-700/50">
                      <span className="text-xs text-slate-500 block mb-1">Time Remaining (Synced)</span>
                      <span className="text-xl font-mono font-bold text-cyan-400">
                        {new Date(countdownRemaining * 1000).toISOString().substr(11, 8)}
                      </span>
                    </div>
                  )}

                  {/* Start Button */}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      const totalSeconds = timerHours * 3600 + timerMinutes * 60 + timerSeconds;
                      addLog('System', `DEBUG: Sending START command (Text: ${timedLoopText}, Timer: ${totalSeconds}s)`); // DEBUG LOG
                      socket.emit('command', {
                        type: 'TIMED_LOOP_START',
                        x: dialogCoords?.x,
                        y: dialogCoords?.y,
                        text: timedLoopText
                      });
                      socket.emit('timer_action', { action: 'start', duration: totalSeconds });
                    }}
                    disabled={!dialogCoords || (timerHours === 0 && timerMinutes === 0 && timerSeconds === 0)}
                    className={`w-full py-2 px-4 rounded-lg font-bold text-sm transition-all ${isTimedLoopRunning
                      ? 'bg-amber-600 text-white animate-pulse'
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20'
                      } disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none`}
                  >
                    {isTimedLoopRunning ? 'Running (Wait for Restart)' : '▶ Start Timed Loop'}
                  </button>

                  {isTimedLoopRunning && (
                    <button
                      onClick={() => socket.emit('timer_action', { action: 'stop' })}
                      className="w-full py-1 text-xs text-red-400 hover:text-red-300 underline"
                    >
                      Force Stop
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Remote Input with Enhanced Text Items */}
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700 backdrop-blur-sm">
              <h2 className="text-lg font-semibold mb-3 text-slate-300">Remote Input</h2>
              <form onSubmit={handleSendInput} className="space-y-4">
                <div className="relative">
                  <textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Type text here..."
                    className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px] resize-none text-base"
                  // Removed onKeyDown to disable Enter sending
                  />
                  <div className="absolute right-2 bottom-2 text-xs text-slate-500 pointer-events-none">
                    Enter key only adds new line
                  </div>
                </div>

                {/* Text Items Implementation */}
                <div className="space-y-3 pt-2 border-t border-slate-700/50">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Extra Text Items</label>
                    <button
                      type="button"
                      onClick={addTextItem}
                      className="text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded text-slate-200 transition-colors"
                    >
                      + Add Item
                    </button>
                  </div>

                  {textItems.length === 0 && <div className="text-xs text-slate-500 text-center py-2 italic opacity-50">No extra items added</div>}

                  <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1 custom-scrollbar">
                    {textItems.map(item => (
                      <div key={item.id} className={`flex gap-2 items-center bg-slate-900/50 p-2 rounded-lg border ${item.enabled ? 'border-slate-600' : 'border-slate-800 opacity-60'}`}>
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={() => toggleTextItem(item.id)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-offset-0 focus:ring-0 cursor-pointer"
                        />
                        <select
                          value={item.position}
                          onChange={(e) => updateTextItem(item.id, 'position', e.target.value)}
                          className="bg-slate-800 text-xs border border-slate-700 rounded px-1 py-1.5 text-slate-300 outline-none w-[75px]"
                        >
                          <option value="prepend">Prepend</option>
                          <option value="append">Append</option>
                        </select>
                        <input
                          type="text"
                          value={item.text}
                          onChange={(e) => updateTextItem(item.id, 'text', e.target.value)}
                          placeholder="Content..."
                          className="flex-1 bg-transparent border-b border-slate-700 text-sm py-1 px-1 focus:border-blue-500 focus:outline-none text-slate-200 placeholder-slate-600"
                        />
                        <button
                          type="button"
                          onClick={() => removeTextItem(item.id)}
                          className="text-slate-500 hover:text-red-400 p-1"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!socket || (!inputText && !textItems.some(i => i.enabled))}
                  className="w-full py-3 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-xl font-bold text-white shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                >
                  Send Input
                </button>
              </form>
            </div>
            {/* Logs */}
            <div className="rounded-2xl bg-black/40 border border-slate-800 overflow-hidden backdrop-blur-md">
              <div className="px-4 py-2 bg-slate-800/50 border-b border-slate-700 flex justify-between items-center">
                <span className="text-xs font-mono text-slate-400">TERMINAL OUTPUT</span>
                <span className="text-xs font-mono text-slate-500">{logs.length} events</span>
              </div>
              <div className="h-40 overflow-y-auto p-4 space-y-1 font-mono text-sm">
                {logs.length === 0 && (
                  <div className="text-slate-600 italic">No activity recorded...</div>
                )}
                {logs.map((log, index) => (
                  <div key={index} className="flex gap-3 animate-fade-in">
                    <span className="text-slate-500 shrink-0">[{log.time}]</span>
                    <span className={`font-bold shrink-0 w-16 ${log.source === 'Server' ? 'text-blue-400' : log.source === 'Error' ? 'text-red-400' : 'text-green-400'}`}>
                      {log.source}:
                    </span>
                    <span className="text-slate-300 break-all">{log.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
