const { io } = require("socket.io-client");

const RAILWAY_URL = "https://antionline-production.up.railway.app";
const TOKEN = "1234"; // Assuming default

console.log("Connecting as VIEWER to", RAILWAY_URL);

const socket = io(RAILWAY_URL, {
    auth: {
        token: TOKEN,
        role: "viewer"
    }
});

socket.on("connect", () => {
    console.log("Connected! ID:", socket.id);
});

socket.on("log", (data) => {
    console.log("[LOG RECEIVED]:", data);
});

socket.on("disconnect", () => {
    console.log("Disconnected");
});

socket.on("connect_error", (err) => {
    console.log("Connect Error:", err.message);
});
