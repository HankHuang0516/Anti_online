require('dotenv').config();
const { io } = require("socket.io-client");
const { spawn } = require('child_process');

// Config
const RAILWAY_URL = "https://antionline-production.up.railway.app";
const ACCESS_CODE = process.env.ACCESS_CODE || "1234";

console.log("Starting Anti-Online Local Agent (Python Bridge Mode)...");
console.log(`Connecting to Cloud Relay: ${RAILWAY_URL}`);

// Connect to Railway Relay
const socket = io(RAILWAY_URL, {
    auth: {
        token: ACCESS_CODE,
        role: "host"
    },
    reconnectionDelayMax: 10000,
    transports: ['websocket'] // Force WebSocket for stability
});

let isConnected = false;
let pyProcess = null;

// --- PYTHON BRIDGE SETUP ---
let buffer = ''; // Buffer for incoming data

const startPythonAgent = () => {
    console.log("Parsing Python Agent...");
    // Use 'python' or 'python3' depending on environment. Assuming 'python' works as per verification.
    pyProcess = spawn('python', ['-u', 'agent.py'], {
        stdio: ['pipe', 'pipe', 'inherit'], // pipe stdin/stdout, inherit stderr for logs
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    // Restore Settings from Cloud
    (async () => {
        try {
            console.log("Fetching configuration from cloud...");
            const res = await fetch(`${RAILWAY_URL}/data`, {
                headers: { 'x-access-code': ACCESS_CODE }
            });
            const userData = await res.json();

            if (userData && pyProcess && pyProcess.stdin) {
                console.log("Restoring cloud settings:", userData);

                // 1. Restore Monitor
                if (userData.currentScreen !== undefined) {
                    console.log(`Restoring Monitor: ${userData.currentScreen}`);
                    pyProcess.stdin.write(JSON.stringify({
                        type: 'SET_MONITOR',
                        index: userData.currentScreen
                    }) + "\n");
                }

                // 2. Restore Offsets/Scale (Optional, if agent supports it or just for logging)
                // Agent stores OFFSET_X/Y globally, we can update them via internal command if needed
                // Currently agent calculates them dynamically based on Monitor.
                // But we can trigger a 'switch' to force update.
            }
        } catch (e) {
            console.error("Failed to fetch cloud settings:", e);
        }
    })();

    pyProcess.stdout.on('data', (data) => {
        buffer += data.toString();

        // Split by newline
        const lines = buffer.split('\n');

        // The last element is either empty (if ended with \n) or an incomplete chunk
        buffer = lines.pop();

        lines.forEach(line => {
            if (!line.trim()) return;
            try {
                const msg = JSON.parse(line);
                if (msg.type === 'screen') {
                    if (isConnected) {
                        socket.emit("screen_update", {
                            image: msg.data,
                            timestamp: Date.now()
                        });
                    }
                } else if (msg.type === 'log') {
                    console.log("[PY]", msg.message);
                    if (isConnected) {
                        console.log("-> Relaying log to Cloud...");
                        socket.emit("log", { message: msg.message });
                    } else {
                        console.warn("-> Cannot relay log: Disconnected");
                    }
                }
            } catch (e) {
                // Should not happen often with valid buffering, but good to catch
                // console.error("Parse error:", e); 
            }
        });
    });

    pyProcess.on('error', (err) => {
        console.error("Failed to start Python process:", err);
    });

    pyProcess.on('close', (code) => {
        console.log(`Python agent exited with code ${code}`);
        // Restart?
        setTimeout(startPythonAgent, 5000);
    });
};

startPythonAgent();

// --- SOCKET EVENTS ---

socket.on("connect", () => {
    console.log(`Connected to Railway! Socket ID: ${socket.id}`);
    isConnected = true;
});

socket.on("disconnect", () => {
    console.log("Disconnected from Railway. Reconnecting...");
    isConnected = false;
});

socket.on("auth_result", (data) => {
    if (data.success) {
        console.log("Authentication Successful. Host Mode Active.");
    } else {
        console.error("Authentication Failed!", data.message);
    }
});

// --- COMMAND RELAY ---
// --- LOCAL TIMER STATE ---
let localTimerInterval = null;
let localTimerConfig = {
    interval: 30, // Default 30s
    text: '',
    dialogCoords: null, // Fixed: Added missing comma
    // Actually, agent.py needs 'x' and 'y' for TIMED_LOOP_START.
    // The Web sends these in the config or we rely on the agent's memory?
    // Better: Web sends params.
    params: {},
    endTime: 0, // Track for Web Sync
    running: false
};

// --- COMMAND RELAY ---
socket.on("command", (data) => {
    // console.log("Received remote command:", JSON.stringify(data)); // DEBUG LOG: Too spammy if loop running

    // INTERCEPT: Local Timer Configuration
    if (data.type === 'CONFIGURE_LOCAL_LOOP') {
        if (data.enabled) {
            console.log(`[LOCAL] Starting Local Timer A (Interval: ${data.interval}s)`);

            // Update Config
            localTimerConfig.interval = data.interval || 30;
            localTimerConfig.text = data.text || '';
            localTimerConfig.params = {
                x: data.x,
                y: data.y,
                text: data.text
            };
            localTimerConfig.running = true;
            localTimerConfig.endTime = Date.now() + (localTimerConfig.interval * 1000);

            // Sync with Web (Emit through Railway Relay)
            socket.emit('timer_updated', {
                running: true,
                endTime: localTimerConfig.endTime,
                originalDuration: localTimerConfig.interval
            });

            // Clear existing
            if (localTimerInterval) clearInterval(localTimerInterval);

            // Start New Timer
            localTimerInterval = setInterval(() => {
                if (pyProcess && pyProcess.stdin) {
                    console.log("[LOCAL] Timer A Tick -> Triggering Agent");

                    // 1. Trigger Agent Action
                    const triggerCmd = {
                        type: 'TIMED_LOOP_START',
                        x: localTimerConfig.params.x,
                        y: localTimerConfig.params.y,
                        text: localTimerConfig.params.text
                    };
                    pyProcess.stdin.write(JSON.stringify(triggerCmd) + "\n");

                    // 2. Update EndTime for next cycle
                    localTimerConfig.endTime = Date.now() + (localTimerConfig.interval * 1000);

                    // 3. Sync with Web
                    socket.emit('timer_updated', {
                        running: true,
                        endTime: localTimerConfig.endTime,
                        originalDuration: localTimerConfig.interval
                    });

                    // 4. Log
                    if (isConnected) socket.emit('log', { message: '[Local] Timer A Triggered' });
                }
            }, localTimerConfig.interval * 1000);

        } else {
            console.log("[LOCAL] Stopping Local Timer A");
            localTimerConfig.running = false;
            localTimerConfig.endTime = 0;
            if (localTimerInterval) {
                clearInterval(localTimerInterval);
                localTimerInterval = null;
            }
            // Sync Stop with Web
            socket.emit('timer_updated', {
                running: false,
                endTime: 0,
                originalDuration: 0
            });
        }
        return;
    }

    // Default: Forward to Python
    if (pyProcess && pyProcess.stdin) {
        try {
            // console.log("Writing to Python Stdin...");
            pyProcess.stdin.write(JSON.stringify(data) + "\n");
        } catch (e) {
            console.error("Failed to write to python stdin", e);
        }
    } else {
        console.error("Python process not ready/stdin closed");
    }
});

const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const WEB_PORT = 7000;

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(WEB_PORT, () => {
    console.log(`Local Server Interface running at: http://localhost:${WEB_PORT}`);
});

console.log("Agent running. Press Ctrl+C to stop.");
