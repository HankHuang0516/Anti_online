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
        origin: "*", // Allow all origins for simplicity/demo
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE;
const DATABASE_URL = process.env.DATABASE_URL;

// Database Connection
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

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

// if (DATABASE_URL) {  <-- Removed redundant call
//     initDB();
// }

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

// In-Memory Shared State
let sharedState = {
    timedLoopText: '',
    timedLoopEnabled: false,
    timer: {
        running: false,
        endTime: 0,
        originalDuration: 0
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
        console.log("Shared State initialized from DB:", sharedState);
    } catch (err) {
        console.error('Error loading shared state:', err);
    }
};

if (DATABASE_URL) {
    initDB().then(initSharedState);
}

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
        // Broadcast to all including sender (simple consistency)
        io.emit('text_updated', { text });
    });

    socket.on('update_enabled', (enabled) => {
        sharedState.timedLoopEnabled = enabled;
        io.emit('enabled_updated', { enabled });
    });

    socket.on('timer_action', (data) => {
        // data: { action: 'start'|'stop', duration: sec }
        if (data.action === 'start') {
            const now = Date.now();
            sharedState.timer = {
                running: true,
                endTime: now + (data.duration * 1000),
                originalDuration: data.duration
            };
        } else if (data.action === 'stop') {
            sharedState.timer = {
                running: false,
                endTime: 0,
                originalDuration: 0
            };
        }
        io.emit('timer_updated', sharedState.timer);
    });

    // 2. Role Assignment
    if (role === 'host') {
        console.log('HOST connected');
        socket.join('host');

        // Notify viewers that host is online
        io.to('viewer').emit('log', { message: 'Host connected' });

        // Relay Events from Host -> Viewers
        socket.on('screen_update', (data) => {
            // Broadcast to all viewers (volatile to drop frames if lagged)
            io.to('viewer').emit('screen_update', data);
        });

        socket.on('log', (data) => {
            io.to('viewer').emit('log', data);
        });

        socket.on('disconnect', () => {
            console.log('HOST disconnected');
            io.to('viewer').emit('log', { message: 'Host disconnected' });
        });

    } else {
        // Viewer
        console.log('VIEWER connected');
        socket.join('viewer');

        // Relay Events from Viewer -> Host
        socket.on('command', (data) => {
            console.log(`[RELAY] Viewer sent command: ${data.type}`); // DEBUG LOG
            io.to('host').emit('command', data);
        });

        socket.on('disconnect', () => {
            console.log('VIEWER disconnected');
        });
    }
});

server.listen(PORT, () => {
    console.log(`Relay Server running on port ${PORT}`);
});
