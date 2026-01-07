import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

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

  // Server URL Management
  const [serverUrl, setServerUrl] = useState(localStorage.getItem('anti_online_server_url') || 'http://localhost:3001');
  const [socket, setSocket] = useState(null);

  const [connected, setConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [logs, setLogs] = useState([]);
  const [macroMode, setMacroMode] = useState(false);
  const [inputText, setInputText] = useState('');
  const [screenImage, setScreenImage] = useState(null);
  const [dialogCoords, setDialogCoords] = useState(savedSettings?.dialogCoords || null);
  const [settingMode, setSettingMode] = useState(null); // 'dialog', 'terminal-id', null
  const [terminals, setTerminals] = useState(savedSettings?.terminals || []);
  const [mouseMode, setMouseMode] = useState('off');
  const [autoAccept, setAutoAccept] = useState(false);
  const [dpiScale, setDpiScale] = useState(savedSettings?.dpiScale || 1.25);
  const [offsetX, setOffsetX] = useState(savedSettings?.offsetX || 0);
  const [offsetY, setOffsetY] = useState(savedSettings?.offsetY || 0);
  const [currentScreen, setCurrentScreen] = useState(savedSettings?.currentScreen || 0);
  const logEndRef = useRef(null);
  const [showSettings, setShowSettings] = useState(false);

  // Helper to check if any setting mode is active
  const isSettingAnything = settingMode !== null;

  // Ref for the main image in the App component
  const imageRef = useRef(null);

  // Save settings to localStorage when they change
  useEffect(() => {
    const settings = {
      dialogCoords,
      terminals,
      dpiScale,
      offsetX,
      offsetY,
      currentScreen
    };
    localStorage.setItem('anti_online_settings', JSON.stringify(settings));
  }, [dialogCoords, terminals, dpiScale, offsetX, offsetY, currentScreen]);

  // Initialize socket when server URL changes
  useEffect(() => {
    if (socket) {
      socket.disconnect();
    }

    // Add header to skip ngrok browser warning
    const newSocket = io(serverUrl, {
      extraHeaders: {
        "ngrok-skip-browser-warning": "true"
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
      setIsAuthenticated(false);
      addLog('System', 'Disconnected from server');
    });

    socket.on('log', (data) => {
      addLog('Server', data.message);
    });

    socket.on('screen_update', (data) => {
      setScreenImage(`data:image/jpeg;base64,${data.image}`);
    });

    socket.on('auth_result', (data) => {
      if (data.success) {
        setIsAuthenticated(true);
        addLog('System', 'Authentication successful');
        // Resend settings after auth
        socket.emit('command', { type: 'SET_DPI_SCALE', scale: dpiScale });
        socket.emit('command', { type: 'SET_SCREEN_OFFSET', x: offsetX, y: offsetY, width: currentScreen === 0 ? 1920 : 1920, height: currentScreen === 0 ? 1200 : 1080 }); // Simplification, ideally use exact values
      } else {
        alert('Invalid access code');
        addLog('System', 'Authentication failed');
      }
    });

    socket.on('error', (data) => {
      addLog('Error', data.message);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('log');
      socket.off('screen_update');
      socket.off('auth_result');
      socket.off('error');
    };
  }, [socket, dpiScale, offsetX, offsetY, currentScreen]);

  const handleAuth = (e) => {
    e.preventDefault();
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
  const getLogicalCoords = (e) => {
    const container = e.currentTarget;
    const img = container.querySelector('img');
    if (!img) return null;

    const rect = img.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
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

  const toggleMacroMode = () => {
    setMacroMode(prev => {
      const newState = !prev;
      if (socket) {
        socket.emit('command', { type: newState ? 'MACRO_MODE_ON' : 'MACRO_MODE_OFF' });
        addLog('System', `Macro Mode ${newState ? 'enabled' : 'disabled'}`);
      }
      return newState;
    });
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
    if (socket && inputText.trim() && dialogCoords) {
      socket.emit('command', { type: 'INPUT_TEXT', text: inputText, dialogX: dialogCoords.x, dialogY: dialogCoords.y });
      addLog('User', `Sent input: "${inputText}"`);
      setInputText('');
    } else if (!dialogCoords) {
      addLog('Error', 'Dialog position not set. Cannot send input.');
    }
  };

  const SettingsModal = () => (
    <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-sm z-50 flex flex-col p-4 overflow-y-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">Settings & Calibration</h2>
        <button
          onClick={() => setShowSettings(false)}
          className="text-slate-400 hover:text-white p-2"
        >
          ✕ Close
        </button>
      </div>

      <div className="flex-1 space-y-8 max-w-2xl mx-auto w-full pb-8">
        {/* Live Stream View for Calibration */}
        <div className="space-y-2">
          <div className="text-sm text-slate-400 mb-1 flex justify-between">
            <span>Live Calibration Preview</span>
            {isSettingAnything && <span className="text-yellow-500 font-bold animate-pulse">Select position on screen...</span>}
          </div>
          <div
            className={`rounded-xl bg-black border overflow-hidden aspect-video flex items-center justify-center relative cursor-crosshair ${isSettingAnything ? 'border-yellow-500 border-2' : 'border-slate-700'}`}
            onClick={handleImageClick}
          >
            {screenImage ? (
              <img
                src={screenImage}
                alt="Calibration View"
                className="w-full h-full object-contain"
                draggable={false}
              />
            ) : (
              <div className="text-slate-600">Waiting for stream...</div>
            )}
            {isSettingAnything && (
              <div className="absolute inset-0 bg-yellow-500/10 pointer-events-none flex items-center justify-center">
                <div className="bg-black/50 px-2 py-1 rounded text-white text-xs">Tap target position</div>
              </div>
            )}
            {dialogCoords && (
              <div className="absolute bottom-2 left-2 pointer-events-none bg-green-500/80 text-white px-2 py-1 rounded text-xs font-mono">
                Dialog: ({dialogCoords.x}, {dialogCoords.y})
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500 text-center">Use this preview to set positions. Click on the image above when "Set Position" is active.</p>
        </div>

        {/* Dialog Position */}
        <div className="bg-slate-800 p-4 rounded-xl space-y-3">
          <h3 className="font-medium text-slate-300 border-b border-slate-700 pb-2">Dialog Calibration</h3>
          <div className="flex items-center justify-between">
            <div className="text-sm font-mono text-slate-400">
              Current: {dialogCoords ? `(${dialogCoords.x}, ${dialogCoords.y})` : 'Not set'}
            </div>
            <button
              onClick={() => setSettingMode(settingMode === 'dialog' ? null : 'dialog')}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${settingMode === 'dialog' ? 'bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.5)]' : 'bg-purple-600 hover:bg-purple-500 text-white'}`}
            >
              {settingMode === 'dialog' ? 'Cancel' : 'Set Position'}
            </button>
          </div>
          <p className="text-xs text-slate-500">The "Accept" button location.</p>
        </div>

        {/* Terminals Configuration */}
        <div className="bg-slate-800 p-4 rounded-xl space-y-4">
          <div className="flex justify-between items-center border-b border-slate-700 pb-2">
            <h3 className="font-medium text-slate-300">Terminals Config</h3>
            <button onClick={addTerminal} className="text-xs bg-green-600 hover:bg-green-500 px-3 py-1.5 rounded font-bold text-white shadow-sm">+ Add Terminal</button>
          </div>

          <div className="space-y-3">
            {terminals.length === 0 && <div className="text-center text-slate-500 text-sm">No terminals configured</div>}
            {terminals.map(t => (
              <div key={t.id} className="bg-slate-900 p-3 rounded-lg flex flex-col gap-3 border border-slate-700">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-slate-300">{t.name}</span>
                  <button onClick={() => removeTerminal(t.id)} className="text-red-400 hover:text-red-300 p-1">✕</button>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={t.command}
                    onChange={(e) => updateTerminalCommand(t.id, e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-300 focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="npm start">npm start</option>
                    <option value="npm run dev">npm run dev</option>
                  </select>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-slate-800">
                  <span className="text-xs font-mono text-slate-500">{t.x !== null ? `Pos: (${t.x}, ${t.y})` : 'Pos: Not set'}</span>
                  <button
                    onClick={() => setSettingMode(settingMode === `terminal-${t.id}` ? null : `terminal-${t.id}`)}
                    className={`px-3 py-1.5 rounded text-xs font-bold transition-colors ${settingMode === `terminal-${t.id}` ? 'bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.5)]' : 'bg-slate-700 hover:bg-slate-600 text-slate-200'}`}
                  >
                    {settingMode === `terminal-${t.id}` ? 'Cancel' : 'Set Pos'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* DPI Scale Setting */}
        <div className="bg-slate-800 p-4 rounded-xl space-y-4">
          <div className="flex justify-between items-center border-b border-slate-700 pb-2">
            <label className="font-medium text-slate-300">DPI Scale</label>
            <span className="font-mono text-cyan-400 bg-slate-900 px-2 py-1 rounded">{dpiScale.toFixed(2)}</span>
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
          <p className="text-xs text-slate-500">Adjust if mouse clicks are offset significantly.</p>
        </div>

        {/* X/Y Offset Fine-tuning */}
        <div className="bg-slate-800 p-4 rounded-xl space-y-4">
          <label className="font-medium text-slate-300 block border-b border-slate-700 pb-2">Screen Offset Correction</label>

          <div className="space-y-4">
            <div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-slate-400">X Offset</span>
                <span className="font-mono text-cyan-400 bg-slate-900 px-2 py-1 rounded">{offsetX}px</span>
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
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-slate-400">Y Offset</span>
                <span className="font-mono text-cyan-400 bg-slate-900 px-2 py-1 rounded">{offsetY}px</span>
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

        <div className="bg-slate-800 p-4 rounded-xl">
          <h3 className="font-medium text-slate-300 mb-2">Instructions</h3>
          <ul className="text-sm text-slate-400 list-disc list-inside space-y-1">
            <li>Use DPI Scale for overall scaling issues (e.g. 1.25 for 125%).</li>
            <li>Use X/Y Offsets to fine-tune if clicks are consistently off by a few pixels.</li>
            <li>Changes are saved automatically.</li>
          </ul>
        </div>

        <button
          onClick={() => setShowSettings(false)}
          className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-white shadow-lg sticky bottom-0"
        >
          Save & Close
        </button>
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
          <div className="mb-4">
            <label htmlFor="serverUrl" className="block text-sm font-medium text-slate-400 mb-1">Server URL</label>
            <input
              type="text"
              id="serverUrl"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-slate-700 border border-slate-600 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., http://localhost:3001"
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
              // Attempt to connect with new server URL and access code
              localStorage.setItem('anti_online_server_url', serverUrl);
              const newSocket = io(serverUrl, {
                auth: { token: accessCode },
                transports: ['websocket', 'polling'],
              });
              setSocket(newSocket);
              addLog('System', `Attempting to connect to ${serverUrl}...`);
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
                  onClick={toggleMacroMode}
                  className={`w-full py-2 px-4 rounded-lg font-medium transition-all text-sm ${macroMode ? 'bg-green-600 hover:bg-green-500' : 'bg-slate-700 hover:bg-slate-600'}`}
                >
                  {macroMode ? 'Macro Mode Active' : 'Enable Macro Mode'}
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

            {/* Remote Input */}
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700 backdrop-blur-sm">
              <h2 className="text-lg font-semibold mb-3 text-slate-300">Remote Input</h2>
              <form onSubmit={handleSendInput} className="flex gap-2 items-end">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendInput(e);
                    }
                  }}
                  placeholder="Type command... (Enter to send, Shift+Enter for new line)"
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-y min-h-[80px]"
                />
                <button
                  type="submit"
                  disabled={!dialogCoords}
                  className={`px-4 py-2 rounded-lg font-medium text-sm ${dialogCoords ? 'bg-cyan-600 hover:bg-cyan-500' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}
                >
                  Send
                </button>
              </form>
            </div>
          </div>
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
  );
}

export default App;
