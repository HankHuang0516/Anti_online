const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE;
const DATABASE_URL = process.env.DATABASE_URL;

// Database Connection
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Railway generic Postgres
});

// Initialize Database
const initDB = async () => {
    try {
        const client = await pool.connect();
        // Create simple key-value store or user_settings table
        // For single user mode, we can just use ID=1
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

initDB();

// Middleware to verify code
const verifyAuth = (req, res, next) => {
    const code = req.headers['x-access-code'] || req.body.code;
    if (!ACCESS_CODE) return next(); // If no code set on server, allow? Or block. Better block.
    // Actually for initial verify we check body.code.
    // For data sync we might use header.

    if (code === ACCESS_CODE) {
        next();
    } else {
        res.status(401).json({ success: false, message: 'Unauthorized' });
    }
};

app.post('/verify', (req, res) => {
    const { code } = req.body;

    if (!ACCESS_CODE) {
        console.error('ACCESS_CODE env var not set');
        return res.status(500).json({ success: false, message: 'Server misconfiguration' });
    }

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
    // Also support body.code if header not present?
    // Let's rely on header for cleaner data payload
    if (ACCESS_CODE && code !== ACCESS_CODE) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { data } = req.body;
    if (!data) return res.status(400).json({ error: 'Missing data' });

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
    res.send('Anti Online Auth Server Running');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
