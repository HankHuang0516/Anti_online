const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    pingTimeout: 60000, // Increase to 60s
    pingInterval: 25000,
    transports: ['websocket', 'polling'] // Explicit
});

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE;
const DATABASE_URL = process.env.DATABASE_URL;

// Database Connection
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// In-Memory Shared State (Global)
let sharedState = {
    timedLoopText: '',
    timedLoopEnabled: false,
    dialogCoords: null, // Needed for loop command
    hostConnected: false,
    hostAllowed: false, // Initial: Disconnected
    hostConnected: false,
    hostAllowed: false, // Initial: Disconnected
    // timer: removed (moved to local agent)
};

let commandQueue = []; // Queue for pending commands when Host is offline
let hostSocketId = null; // Track active host socket

// Initialize Database
const initDB = async () => {
    try {
        const client = await pool.connect();
        await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        id SERIAL PRIMARY KEY,
        data JSONB NOT NULL DEFAULT '{}'
      );
    `);

        // Ensure row 1 exists
        const res = await client.query('SELECT * FROM user_settings WHERE id = 1');
        if (res.rowCount === 0) {
            await client.query('INSERT INTO user_settings (id, data) VALUES (1, $1)', [JSON.stringify({})]);
        }

        client.release();
        console.log('Database initialized');
    } catch (err) {
        console.error('Error initializing database:', err);
    }
};

// Initialize Shared State from DB
const initSharedState = async () => {
    if (!DATABASE_URL) return;
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT data FROM user_settings WHERE id = 1');
        client.release();

        const savedData = result.rows[0]?.data || {};
        if (savedData.timedLoopText) {
            sharedState.timedLoopText = savedData.timedLoopText;
        }
        if (savedData.timedLoopEnabled !== undefined) {
            sharedState.timedLoopEnabled = savedData.timedLoopEnabled;
        }
        if (savedData.dialogCoords) {
            sharedState.dialogCoords = savedData.dialogCoords;
        }
        // hostConnected always starts false until host joins
        console.log("Shared State initialized from DB:", sharedState);
    } catch (err) {
        console.error('Error loading shared state:', err);
    }
};

if (DATABASE_URL) {
    initDB().then(initSharedState);
}

// REST Endpoints
app.post('/verify', (req, res) => {
    const { code } = req.body;
    if (code === ACCESS_CODE) {
        return res.json({ success: true });
    } else {
        return res.json({ success: false });
    }
});

app.get('/data', async (req, res) => {
    const code = req.headers['x-access-code'];
    if (ACCESS_CODE && code !== ACCESS_CODE) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT data FROM user_settings WHERE id = 1');
        client.release();
        res.json(result.rows[0]?.data || {});
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.post('/data', async (req, res) => {
    const code = req.headers['x-access-code'];
    if (ACCESS_CODE && code !== ACCESS_CODE) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const { data } = req.body;
    try {
        const client = await pool.connect();
        await client.query('UPDATE user_settings SET data = $1 WHERE id = 1', [data]);
        client.release();

        // Update In-Memory State immediately
        if (data.timedLoopText !== undefined) sharedState.timedLoopText = data.timedLoopText;
        if (data.timedLoopEnabled !== undefined) sharedState.timedLoopEnabled = data.timedLoopEnabled;
        if (data.dialogCoords) sharedState.dialogCoords = data.dialogCoords;

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/', (req, res) => {
    res.send('Anti Online Relay Server Running');
});




// --- SOCKET.IO RELAY LOGIC ---

io.on('connection', (socket) => {
    const auth = socket.handshake.auth || {};
    const token = auth.token;
    const role = auth.role; // 'host' (local server) or undefined (viewer)

    // 1. Authenticate
    if (ACCESS_CODE && token !== ACCESS_CODE) {
        console.log('Socket auth failed');
        socket.emit('auth_result', { success: false, message: 'Invalid token' });
        socket.disconnect(true);
        return;
    }

    socket.emit('auth_result', { success: true });

    // 2. Send Initial State
    socket.emit('state_sync', sharedState);

    // 3. Handle Updates
    socket.on('update_text', (text) => {
        sharedState.timedLoopText = text;
        // Broadcast to others ONLY (avoid echo back to sender which disrupts typing)
        socket.broadcast.emit('text_updated', { text });
    });

    socket.on('update_enabled', (enabled) => {
        sharedState.timedLoopEnabled = enabled;
        socket.broadcast.emit('enabled_updated', { enabled });
    });



    // 2. Role Assignment
    if (role === 'host') {
        // Gating Logic: Check if Host Connection is Allowed
        if (!sharedState.hostAllowed) {
            console.log('Host connection rejected: Not allowed by Web');
            socket.emit('auth_result', { success: false, message: 'Connection not enabled by Web' });
            socket.disconnect(true);
            return;
        }

        console.log('HOST connected');
        socket.join('host');
        hostSocketId = socket.id;
        sharedState.hostConnected = true;
        io.emit('host_status', { connected: true });

        // Notify viewers that host is online
        io.to('viewer').emit('log', { message: 'Host connected' });

        // Flush Command Queue
        if (commandQueue.length > 0) {
            console.log(`[RELAY] Flushing ${commandQueue.length} queued commands to Host`);
            commandQueue.forEach(cmd => {
                socket.emit('command', cmd);
            });
            commandQueue = [];
        }

        // Relay Events from Host -> Viewers
        socket.on('screen_update', (data) => {
            // Broadcast to all viewers (volatile to drop frames if lagged)
            io.to('viewer').emit('screen_update', data);
        });

        socket.on('log', (data) => {
            io.to('viewer').emit('log', data);
        });

        socket.on('timer_updated', (data) => {
            io.to('viewer').emit('timer_updated', data);
        });

        socket.on('disconnect', () => {
            console.log('HOST disconnected');
            if (hostSocketId === socket.id) {
                hostSocketId = null;
                sharedState.hostConnected = false;
                io.emit('host_status', { connected: false });
            }
            io.to('viewer').emit('log', { message: 'Host disconnected' });
        });

    } else {
        // Viewer
        console.log('VIEWER connected');
        socket.join('viewer');

        // Track Viewers
        const viewers = io.sockets.adapter.rooms.get('viewer');
        const viewerCount = viewers ? viewers.size : 0;
        console.log(`Viewer count: ${viewerCount}`);

        // Send Current Host Allowed Status
        socket.emit('host_allowed_status', { allowed: sharedState.hostAllowed });

        // Toggle Host Connection
        socket.on('toggle_host_connection', (allowed) => {
            console.log(`[RELAY] Viewer set hostAllowed to: ${allowed}`);
            sharedState.hostAllowed = allowed;
            io.emit('host_allowed_status', { allowed: sharedState.hostAllowed });

            if (!allowed && hostSocketId) {
                console.log("[RELAY] Host disabled by Web. Disconnecting Host...");
                const hostSocket = io.sockets.sockets.get(hostSocketId);
                if (hostSocket) {
                    hostSocket.emit('auth_result', { success: false, message: 'Connection disabled by Web' });
                    hostSocket.disconnect(true);
                }
            }
        });

        // Relay Events from Viewer -> Host
        socket.on('command', (data) => {
            console.log(`[RELAY] Viewer sent command: ${data.type}`); // DEBUG LOG

            if (hostSocketId) {
                io.to('host').emit('command', data);
            } else {
                console.log(`[RELAY] Host offline. Queuing command: ${data.type}`);
                // Add timestamp or unique ID if needed?
                commandQueue.push(data);
                // Limit queue size
                if (commandQueue.length > 20) commandQueue.shift();

                // Feedback to viewer?
                socket.emit('log', { message: `[Server] Host offline. Command queued: ${data.type}` });
            }
        });

        socket.on('disconnect', () => {
            console.log('VIEWER disconnected');

            // Check remaining viewers
            setTimeout(() => {
                const viewers = io.sockets.adapter.rooms.get('viewer');
                const count = viewers ? viewers.size : 0;
                console.log(`Remaining viewers: ${count}`);

                if (count === 0) {
                    console.log("[RELAY] All viewers disconnected. Disabling Host Connection...");
                    sharedState.hostAllowed = false; // Reset to false

                    if (hostSocketId) {
                        console.log("[RELAY] Disconnecting Host...");
                        const hostSocket = io.sockets.sockets.get(hostSocketId);
                        if (hostSocket) {
                            hostSocket.emit('auth_result', { success: false, message: 'Web disconnected' });
                            hostSocket.disconnect(true);
                        }
                    }
                }
            }, 100);
        });
    }
});

server.listen(PORT, () => {
    console.log(`Relay Server running on port ${PORT}`);
});
