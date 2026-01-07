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
  const [settingMode, setSettingMode] = useState(null);
  const [terminals, setTerminals] = useState(savedSettings?.terminals || []);
  const [mouseMode, setMouseMode] = useState('off');
  const [autoAccept, setAutoAccept] = useState(false);
  const [dpiScale, setDpiScale] = useState(savedSettings?.dpiScale || 1.25);
  const [offsetX, setOffsetX] = useState(savedSettings?.offsetX || 0);
  const [offsetY, setOffsetY] = useState(savedSettings?.offsetY || 0);
  const [currentScreen, setCurrentScreen] = useState(savedSettings?.currentScreen || 0);
  const logEndRef = useRef(null);
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
  }, [socket, dpiScale, offsetX, offsetY, currentScreen]); // Added dependencies to likely resend settings

  const handleAuth = (e) => {
    e.preventDefault();
    if (!socket) {
      alert('Socket not connected yet. Please wait or check Server URL.');
      return;
    }
    socket.emit('command', { type: 'AUTH', code: accessCode });
  };

  // Removed auto-scroll to prevent jumping on mobile
  // useEffect(() => {
  //   logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  // }, [logs]);

  // Sync DPI Scale to server
  useEffect(() => {
    if (connected) {
      socket.emit('command', { type: 'SET_DPI_SCALE', scale: dpiScale });
    }
  }, [dpiScale, connected]);


  const addLog = (source, message) => {
    setLogs(prev => [...prev.slice(-49), { time: new Date().toLocaleTimeString(), source, message }]);
  };

  const handleStartAgent = () => {
    socket?.emit('command', { type: 'START_AGENT' });
  };

  const toggleMacroMode = () => {
    const newState = !macroMode;
    setMacroMode(newState);
    socket?.emit('command', { type: 'MACRO_MODE', value: newState });
  };

  const handleSendInput = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    if (!dialogCoords) {
      addLog('Error', 'Please set dialog coordinates first');
      return;
    }
    socket?.emit('command', {
      type: 'INPUT_TEXT',
      text: inputText,
      clickX: dialogCoords.x,
      clickY: dialogCoords.y
    });
    addLog('Me', `Sent: ${inputText}`);
    setInputText('');
  };

  // Calculate logical coordinates from click on image
  const getLogicalCoords = (e) => {
    if (!imageRef.current) return null;
    const rect = imageRef.current.getBoundingClientRect();
    const img = imageRef.current;
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

    // If in mouse click mode, send click command
    if (mouseMode === 'click') {
      socket.emit('command', { type: 'MOUSE_CLICK', x: coords.x, y: coords.y });
      addLog('System', `Mouse click at (${coords.x}, ${coords.y})`);
      return;
    }

    // If setting dialog position
    if (settingMode === 'dialog') {
      setDialogCoords(coords);
      setSettingMode(null);
      addLog('System', `Dialog set to (${coords.x}, ${coords.y})`);
      return;
    }

    // If setting terminal position
    if (settingMode?.startsWith('terminal-')) {
      const terminalId = settingMode.replace('terminal-', '');
      setTerminals(prev => prev.map(t =>
        t.id === terminalId ? { ...t, x: coords.x, y: coords.y } : t
      ));
      setSettingMode(null);
      addLog('System', `Terminal ${terminalId} set to (${coords.x}, ${coords.y})`);
      return;
    }
  };

  // Add new terminal
  const addTerminal = () => {
    const newId = Date.now().toString();
    setTerminals(prev => [...prev, {
      id: newId,
      name: `Terminal ${prev.length + 1}`,
      x: null,
      y: null,
      command: 'npm start'
    }]);
  };

  // Remove terminal
  const removeTerminal = (id) => {
    setTerminals(prev => prev.filter(t => t.id !== id));
  };

  // Restart terminal
  const restartTerminal = (terminal) => {
    if (terminal.x === null || terminal.y === null) {
      addLog('Error', `Set position for ${terminal.name} first`);
      return;
    }
    socket.emit('command', {
      type: 'RESTART_TERMINAL',
      x: terminal.x,
      y: terminal.y,
      command: terminal.command
    });
    addLog('System', `Restarting ${terminal.name}...`);
  };

  // Update terminal command
  const updateTerminalCommand = (id, command) => {
    setTerminals(prev => prev.map(t =>
      t.id === id ? { ...t, command } : t
    ));
  };

  const isSettingAnything = settingMode !== null;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-200 flex items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-700">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent mb-6 text-center">
            Antigravity Access
          </h1>
          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Server URL</label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                placeholder="http://localhost:3001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Access Code</label>
              <input
                type="password"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter access code"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-lg transition-all"
            >
              Verify Identity
            </button>
            <div className={`text-center text-xs ${connected ? 'text-green-500' : 'text-yellow-500'}`}>
              {connected ? '🟢 Connected to Server' : `🔴 Connecting to ${serverUrl}...`}
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-dark text-slate-200 p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-slate-700 pb-4">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            Anti Online
          </h1>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}></span>
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Live Stream View */}
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

            {/* Note: Multi-screen not supported by nut-tree */}

            {/* Mouse Control */}
            <div className="flex gap-2">
              <button
                onClick={() => setMouseMode('off')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${mouseMode === 'off' ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                🖱️ Off
              </button>
              <button
                onClick={() => setMouseMode('click')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${mouseMode === 'click' ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                👆 Click Mode
              </button>
            </div>

            {/* DPI Scale Setting */}
            <div className="flex items-center gap-3 bg-slate-800/50 rounded-lg p-2">
              <span className="text-xs text-slate-400">DPI Scale:</span>
              <input
                type="range"
                min="1"
                max="2"
                step="0.05"
                value={dpiScale}
                onChange={(e) => setDpiScale(parseFloat(e.target.value))}
                className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-xs font-mono text-cyan-400 w-10">{dpiScale.toFixed(2)}</span>
            </div>

            {/* X/Y Offset Fine-tuning */}
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 bg-slate-800/50 rounded-lg p-2">
                <span className="text-xs text-slate-400">X:</span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="5"
                  value={offsetX}
                  onChange={(e) => setOffsetX(parseInt(e.target.value))}
                  className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-xs font-mono text-cyan-400 w-8">{offsetX}</span>
              </div>
              <div className="flex-1 flex items-center gap-2 bg-slate-800/50 rounded-lg p-2">
                <span className="text-xs text-slate-400">Y:</span>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  step="5"
                  value={offsetY}
                  onChange={(e) => setOffsetY(parseInt(e.target.value))}
                  className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                />
                <span className="text-xs font-mono text-cyan-400 w-8">{offsetY}</span>
              </div>
            </div>
          </div>

          {/* Controls & Logs */}
          <div className="space-y-4">
            {/* Controls */}
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700 backdrop-blur-sm">
              <h2 className="text-lg font-semibold mb-3 text-slate-300">Agent Control</h2>
              <div className="space-y-2">
                <button
                  onClick={handleStartAgent}
                  className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium transition-all text-sm"
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

            {/* Dialog Position */}
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700 backdrop-blur-sm">
              <h2 className="text-lg font-semibold mb-3 text-slate-300">Dialog Position</h2>
              <button
                onClick={() => setSettingMode(settingMode === 'dialog' ? null : 'dialog')}
                className={`w-full py-2 px-4 rounded-lg font-medium transition-all text-sm ${settingMode === 'dialog' ? 'bg-yellow-500 text-black' : 'bg-purple-600 hover:bg-purple-500'}`}
              >
                {settingMode === 'dialog' ? '🎯 Click on screen...' : '📍 Set Position'}
              </button>
              {dialogCoords && (
                <div className="mt-2 text-center text-green-400 font-mono text-sm">
                  ({dialogCoords.x}, {dialogCoords.y})
                </div>
              )}
            </div>

            {/* Terminal Positions */}
            <div className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700 backdrop-blur-sm">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-semibold text-slate-300">Terminals</h2>
                <button
                  onClick={addTerminal}
                  className="text-xs bg-green-600 hover:bg-green-500 px-2 py-1 rounded font-medium"
                >
                  + Add
                </button>
              </div>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {terminals.length === 0 && (
                  <div className="text-slate-500 text-sm text-center py-2">No terminals added</div>
                )}
                {terminals.map((terminal, index) => (
                  <div key={terminal.id} className="bg-slate-900 rounded-lg p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-medium w-16">Terminal {index + 1}</span>
                      <select
                        value={terminal.command}
                        onChange={(e) => updateTerminalCommand(terminal.id, e.target.value)}
                        className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-mono"
                      >
                        <option value="npm start">npm start</option>
                        <option value="npm run dev">npm run dev</option>
                      </select>
                      <button
                        onClick={() => removeTerminal(terminal.id)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSettingMode(settingMode === `terminal-${terminal.id}` ? null : `terminal-${terminal.id}`)}
                        className={`flex-1 py-1 px-2 rounded text-xs font-medium ${settingMode === `terminal-${terminal.id}` ? 'bg-yellow-500 text-black' : 'bg-slate-700 hover:bg-slate-600'}`}
                      >
                        {terminal.x !== null ? `(${terminal.x}, ${terminal.y})` : 'Set Pos'}
                      </button>
                      <button
                        onClick={() => restartTerminal(terminal)}
                        disabled={terminal.x === null}
                        className={`py-1 px-3 rounded text-xs font-medium ${terminal.x !== null ? 'bg-orange-600 hover:bg-orange-500' : 'bg-slate-700 text-slate-500 cursor-not-allowed'}`}
                      >
                        ▶ Restart
                      </button>
                    </div>
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
