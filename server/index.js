const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const automation = require('./automation');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all for local dev
        methods: ["GET", "POST"]
    }
});

const PORT = 3001;

// Basic health check
app.get('/', (req, res) => {
    res.send('Anti Online Server is Running');
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });

    // Handle commands from Web Client
    socket.on('command', async (data) => {
        console.log('Received command:', data);
        try {
            if (data.type === 'START_AGENT') {
                await automation.startAgent();
                socket.emit('log', { message: 'Agent start command sent.' });
            } else if (data.type === 'MACRO_MODE') {
                const active = data.value; // true/false
                automation.setMacroMode(active);
                socket.emit('log', { message: `Macro mode set to ${active}` });
            } else if (data.type === 'INPUT_TEXT') {
                await automation.typeText(data.text, data.clickX, data.clickY);
                socket.emit('log', { message: `Typed: ${data.text}` });
            } else if (data.type === 'KEY_PRESS') {
                await automation.pressKey(data.key);
                socket.emit('log', { message: `Pressed: ${data.key}` });
            } else if (data.type === 'STOP_LOOP') {
                automation.stopInputLoop();
                socket.emit('log', { message: 'Loop stop requested' });
            } else if (data.type === 'RESTART_TERMINAL') {
                await automation.restartTerminal(data.x, data.y, data.command || 'npm start');
                socket.emit('log', { message: `Restarted terminal at (${data.x}, ${data.y})` });
            } else if (data.type === 'MOUSE_CLICK') {
                await automation.mouseClick(data.x, data.y);
            } else if (data.type === 'MOUSE_MOVE') {
                await automation.mouseMove(data.x, data.y);
            } else if (data.type === 'AUTO_ACCEPT_START') {
                automation.startAutoAccept();
                socket.emit('log', { message: 'Auto Accept started' });
            } else if (data.type === 'AUTO_ACCEPT_STOP') {
                automation.stopAutoAccept();
                socket.emit('log', { message: 'Auto Accept stopped' });
            } else if (data.type === 'SET_SCREEN_OFFSET') {
                automation.setScreenOffset(data.x, data.y, data.width || 0, data.height || 0);
            }
        } catch (error) {
            console.error('Command error:', error);
            socket.emit('error', { message: error.message });
        }
    });
});

// Start automation listener (if needed)
automation.init(io);

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
