const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ACCESS_CODE = process.env.ACCESS_CODE;

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

app.get('/', (req, res) => {
    res.send('Anti Online Auth Server Running');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
