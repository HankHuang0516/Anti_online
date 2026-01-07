const { keyboard, mouse, screen, straightTo, centerOf, imageResource, sleep, Key } = require('@nut-tree-fork/nut-js');
const Jimp = require('jimp');
const { exec, execSync } = require('child_process');
require('dotenv').config();
const path = require('path');

// Configure resource directory for image matching
screen.config.resourceDirectory = path.join(__dirname, 'assets');
screen.config.confidence = 0.8; // 80% confidence for image matching

let isMacroMode = false;
let ioInstance = null;
let isInputLoopRunning = false;
let shouldStopLoop = false;
let isAutoAcceptRunning = false;
let shouldStopAutoAccept = false;
let screenOffset = { x: 0, y: 0, width: 0, height: 0 }; // Offset and size for multi-monitor support (0 = use default)
let dpiScale = 1.25; // DPI scaling factor, can be updated from web UI

// Template images (loaded on first use)
let acceptButtonTemplate = null;
let acceptAllTemplate = null;
let acceptExactTemplate = null;

const loadTemplates = async () => {
    if (!acceptButtonTemplate) {
        acceptButtonTemplate = await Jimp.read(path.join(__dirname, 'accept_button_then_enter.jpg'));
        console.log(`Loaded accept_button_then_enter.jpg: ${acceptButtonTemplate.bitmap.width}x${acceptButtonTemplate.bitmap.height}`);
    }
    if (!acceptAllTemplate) {
        acceptAllTemplate = await Jimp.read(path.join(__dirname, 'assets', 'accept_all_new.png'));
        console.log(`Loaded accept_all_new.png: ${acceptAllTemplate.bitmap.width}x${acceptAllTemplate.bitmap.height}`);
    }
    if (!acceptExactTemplate) {
        acceptExactTemplate = await Jimp.read(path.join(__dirname, 'assets', 'accept_exact_bgr.png'));
        console.log(`Loaded accept_exact_bgr.png: ${acceptExactTemplate.bitmap.width}x${acceptExactTemplate.bitmap.height}`);
    }
};

// Capture screen and return as Jimp image (with BGR->RGB fix)
// Uses screenOffset to capture from different monitors
const captureScreen = async () => {
    // Get full screen dimensions
    const fullWidth = await screen.width();
    const fullHeight = await screen.height();

    // Calculate capture region (don't use custom width/height, let nut-tree handle it)
    const left = screenOffset.x;
    const top = screenOffset.y;

    // For multi-monitor, if offset is negative, we still use it
    // but limit the capture size to what's available
    const region = {
        left: left,
        top: top,
        width: fullWidth,
        height: fullHeight
    };

    try {
        const grab = await screen.grabRegion(region);

        // Fix BGR -> RGB
        const data = grab.data;
        for (let i = 0; i < data.length; i += 4) {
            const b = data[i];
            const r = data[i + 2];
            data[i] = r;
            data[i + 2] = b;
        }

        return new Jimp({ data: grab.data, width: grab.width, height: grab.height });
    } catch (err) {
        console.error("Screen capture error:", err.message);
        // Return a small valid Jimp image on error
        return new Jimp(100, 100, 0x000000ff);
    }
};

// Simple template matching - returns center coordinates if found, null otherwise
const findTemplate = async (screenImg, templateImg, threshold = 0.85) => {
    const screenW = screenImg.bitmap.width;
    const screenH = screenImg.bitmap.height;
    const tplW = templateImg.bitmap.width;
    const tplH = templateImg.bitmap.height;

    let bestMatch = { x: -1, y: -1, score: 0 };

    // Step size for performance (check every 2 pixels)
    const step = 2;

    // Scan the screen
    for (let y = 0; y <= screenH - tplH; y += step) {
        for (let x = 0; x <= screenW - tplW; x += step) {
            let matchScore = 0;
            let totalPixels = 0;

            // Sample pixels from template (every 3rd pixel for speed)
            for (let ty = 0; ty < tplH; ty += 3) {
                for (let tx = 0; tx < tplW; tx += 3) {
                    const tplIdx = (ty * tplW + tx) * 4;
                    const scrIdx = ((y + ty) * screenW + (x + tx)) * 4;

                    const tr = templateImg.bitmap.data[tplIdx];
                    const tg = templateImg.bitmap.data[tplIdx + 1];
                    const tb = templateImg.bitmap.data[tplIdx + 2];

                    const sr = screenImg.bitmap.data[scrIdx];
                    const sg = screenImg.bitmap.data[scrIdx + 1];
                    const sb = screenImg.bitmap.data[scrIdx + 2];

                    // Calculate color distance
                    const diff = Math.abs(tr - sr) + Math.abs(tg - sg) + Math.abs(tb - sb);
                    const similarity = 1 - (diff / 765); // 765 = 255 * 3

                    matchScore += similarity;
                    totalPixels++;
                }
            }

            const avgScore = matchScore / totalPixels;
            if (avgScore > bestMatch.score) {
                bestMatch = { x, y, score: avgScore };
            }
        }
    }

    if (bestMatch.score >= threshold) {
        // Return center of matched region
        return {
            x: bestMatch.x + Math.floor(tplW / 2),
            y: bestMatch.y + Math.floor(tplH / 2),
            score: bestMatch.score
        };
    }

    return null;
};

// Wait for a template to appear on screen
const waitForTemplate = async (templateImg, timeoutMs = 30000, checkIntervalMs = 500) => {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        if (shouldStopLoop) return null;

        const screenImg = await captureScreen();
        const match = await findTemplate(screenImg, templateImg, 0.80);

        if (match) {
            return match;
        }

        await sleep(checkIntervalMs);
    }

    return null; // Timeout
};

const init = (io) => {
    // Handle commands from web client
    io.on('connection', (socket) => {
        socket.on('CAPTURE_SNAPSHOT', async () => {
            console.log("Creating debug snapshot...");
            try {
                const jimpImage = await captureScreen();
                await jimpImage.writeAsync('server_snapshot.png');
                console.log("Snapshot saved to server_snapshot.png");
                socket.emit('log', { message: "Snapshot saved! Check server folder." });
            } catch (e) {
                console.error("Snapshot failed:", e);
                socket.emit('log', { message: "Snapshot failed" });
            }
        });
    });

    ioInstance = io;
    console.log("Automation module initialized");
    startMonitoring();
};

const startMonitoring = () => {
    setInterval(async () => {
        if (ioInstance) {
            try {
                const jimpImage = await captureScreen();
                const buffer = await jimpImage.quality(60).getBufferAsync(Jimp.MIME_JPEG);
                ioInstance.emit('screen_update', { image: buffer.toString('base64') });
            } catch (err) {
                // Silent fail
            }
        }
    }, 1000);
};

// Main input loop - runs after text is typed
// Main input loop - runs after text is typed
const runInputLoop = async (x, y) => {
    if (isInputLoopRunning) {
        console.log("Input loop already running, stopping previous...");
        shouldStopLoop = true;
        await sleep(1000);
    }

    isInputLoopRunning = true;
    shouldStopLoop = false;

    // Use default coordinates if not provided (fallback)
    const targetX = x !== undefined ? x : 0;
    const targetY = y !== undefined ? y : 0;

    try {
        console.log(`Starting simple input loop at (${targetX}, ${targetY})...`);
        ioInstance?.emit('log', { message: "Starting simple loop: Click -> Alt+Enter every 10s" });

        let loopCount = 0;

        while (!shouldStopLoop) {
            loopCount++;
            console.log(`\n=== Input Loop Iteration ${loopCount} ===`);
            ioInstance?.emit('log', { message: `Loop iteration ${loopCount} - Clicking & Alt+Enter` });

            // Step 1: Click on Dialog Position
            if (targetX !== 0 || targetY !== 0) {
                await mouse.setPosition({ x: targetX, y: targetY });
                await mouse.leftClick();
                console.log(`Clicked dialog at (${targetX}, ${targetY})`);
                await sleep(500);
            } else {
                console.warn("Skipping click - coordinates not set");
            }

            if (shouldStopLoop) break;

            // Step 2: Press Alt+Enter
            await keyboard.pressKey(Key.LeftAlt, Key.Enter);
            await keyboard.releaseKey(Key.LeftAlt, Key.Enter);
            console.log("Pressed Alt+Enter");

            if (shouldStopLoop) break;

            // Step 3: Wait 10 seconds
            console.log("Waiting 10 seconds...");
            // Check for stop every second to allow faster stopping
            for (let i = 0; i < 10; i++) {
                if (shouldStopLoop) break;
                await sleep(1000);
            }
        }

    } catch (error) {
        console.error("Input loop error:", error);
        ioInstance?.emit('log', { message: `Loop error: ${error.message}` });
    } finally {
        isInputLoopRunning = false;
        console.log("Input loop stopped");
        ioInstance?.emit('log', { message: "Input loop stopped" });
    }
};

const startAgent = async () => {
    const agentPath = process.env.ANTIGRAVITY_PATH;
    if (!agentPath) {
        throw new Error("ANTIGRAVITY_PATH not set in .env");
    }

    console.log(`Starting Antigravity at: ${agentPath}`);

    exec(`"${agentPath}"`, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return;
        }
        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
    });
};

const setMacroMode = (active) => {
    isMacroMode = active;
    console.log("Macro mode:", isMacroMode);
};

const typeText = async (text, clickX, clickY) => {
    console.log(`Typing: ${text} at (${clickX}, ${clickY})`);
    try {
        // Stop any existing loop when new input comes
        if (isInputLoopRunning) {
            console.log("New input received, stopping current loop...");
            shouldStopLoop = true;
            await sleep(500);
        }

        // Step 1: Click on the dialog box position
        if (clickX !== undefined && clickY !== undefined) {
            console.log(`Clicking dialog at (${clickX}, ${clickY})`);
            await mouse.setPosition({ x: clickX, y: clickY });
            await mouse.leftClick();
            await sleep(300);
        }

        // Step 2: Copy text to clipboard using PowerShell and paste
        // Escape special characters for PowerShell
        const escapedText = text.replace(/'/g, "''");
        execSync(`powershell -command "Set-Clipboard -Value '${escapedText}'"`, { encoding: 'utf-8' });
        await keyboard.pressKey(Key.LeftControl, Key.V);
        await keyboard.releaseKey(Key.LeftControl, Key.V);
        console.log(`Pasted text via clipboard: ${text}`);

        // Step 3: Press Enter
        await sleep(200);
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        console.log("Pressed Enter after typing");

        ioInstance?.emit('log', { message: `Clicked (${clickX}, ${clickY}), typed and Enter: ${text}` });

        // Step 4: Start the input loop
        await sleep(500);
        runInputLoop(clickX, clickY); // Don't await - run in background

    } catch (err) {
        console.error("Typing failed:", err);
        throw err;
    }
};

const pressKey = async (key) => {
    console.log("Pressing key:", key);

    const keyMap = {
        'ENTER': Key.Enter,
        'SPACE': Key.Space,
        'ESCAPE': Key.Escape,
        'ALT_ENTER': [Key.LeftAlt, Key.Enter],
    };

    const nutKey = keyMap[key.toUpperCase()];
    if (nutKey) {
        if (Array.isArray(nutKey)) {
            await keyboard.pressKey(...nutKey);
            await keyboard.releaseKey(...nutKey);
        } else {
            await keyboard.pressKey(nutKey);
            await keyboard.releaseKey(nutKey);
        }
    } else {
        console.warn(`Key ${key} not mapped.`);
    }
};

// Export a function to stop the loop manually
const stopInputLoop = () => {
    shouldStopLoop = true;
};

// Restart a terminal: click position -> wait 1s -> Ctrl+C -> wait 2s -> paste command -> wait 1s -> Enter
const restartTerminal = async (x, y, command = 'npm start') => {
    console.log(`Restarting terminal at (${x}, ${y}) with command: ${command}`);
    try {
        // 1. Click on Terminal position
        await mouse.setPosition({ x, y });
        await mouse.leftClick();

        // 2. Wait 1 second
        await sleep(1000);

        // 3. Press Ctrl+C to stop current process
        await keyboard.pressKey(Key.LeftControl, Key.C);
        await keyboard.releaseKey(Key.LeftControl, Key.C);
        console.log("Sent Ctrl+C");

        // 4. Wait 2 seconds for process to stop
        await sleep(2000);

        // 5. Paste command via clipboard
        const escapedCommand = command.replace(/'/g, "''");
        execSync(`powershell -command "Set-Clipboard -Value '${escapedCommand}'"`, { encoding: 'utf-8' });
        await keyboard.pressKey(Key.LeftControl, Key.V);
        await keyboard.releaseKey(Key.LeftControl, Key.V);
        console.log(`Pasted command: ${command}`);

        // 6. Wait 1 second
        await sleep(1000);

        // 7. Press Enter to execute
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        console.log("Pressed Enter - terminal restarted");

        ioInstance?.emit('log', { message: `Terminal restarted at (${x}, ${y})` });
    } catch (err) {
        console.error("Restart terminal failed:", err);
        throw err;
    }
};

// Mouse click at specific position
const mouseClick = async (x, y) => {
    console.log(`Mouse click at (${x}, ${y})`);
    await mouse.setPosition({ x, y });
    await mouse.leftClick();
    ioInstance?.emit('log', { message: `Clicked at (${x}, ${y})` });
};

// Mouse move to position (for drag mode)
const mouseMove = async (x, y) => {
    await mouse.setPosition({ x, y });
};

// Auto Accept All - detect and click accept button every 3 seconds
const autoAcceptLoop = async () => {
    if (isAutoAcceptRunning) {
        console.log("Auto Accept already running");
        return;
    }

    isAutoAcceptRunning = true;
    shouldStopAutoAccept = false;

    try {
        await loadTemplates();
        console.log("Auto Accept All started - scanning every 3 seconds...");
        ioInstance?.emit('log', { message: "Auto Accept All started" });

        while (!shouldStopAutoAccept) {
            try {
                const screenImg = await captureScreen();
                const match = await findTemplate(screenImg, acceptExactTemplate, 0.92);

                if (match) {
                    // Convert physical coords to logical using dpiScale
                    const logicalX = Math.floor(match.x / dpiScale);
                    const logicalY = Math.floor(match.y / dpiScale);

                    console.log(`Auto Accept: Found at (${logicalX}, ${logicalY}) score: ${match.score.toFixed(2)}`);
                    ioInstance?.emit('log', { message: `Auto clicked Accept at (${logicalX}, ${logicalY})` });

                    await mouse.setPosition({ x: logicalX, y: logicalY });
                    await mouse.leftClick();

                    // Wait a bit after clicking to avoid double-clicks
                    await sleep(1000);
                }
            } catch (err) {
                // Silent fail for individual scan errors
            }

            // Wait 3 seconds before next scan
            await sleep(3000);
        }
    } catch (error) {
        console.error("Auto Accept error:", error);
        ioInstance?.emit('log', { message: `Auto Accept error: ${error.message}` });
    } finally {
        isAutoAcceptRunning = false;
        console.log("Auto Accept All stopped");
        ioInstance?.emit('log', { message: "Auto Accept All stopped" });
    }
};

const startAutoAccept = () => {
    autoAcceptLoop(); // Don't await - run in background
};

const stopAutoAccept = () => {
    shouldStopAutoAccept = true;
};

// Set screen offset for multi-monitor capture
const setScreenOffset = (x, y, width = 0, height = 0) => {
    screenOffset = { x, y, width, height };
    console.log(`Screen offset set to (${x}, ${y}) size: ${width}x${height}`);
    ioInstance?.emit('log', { message: `Screen switched: offset (${x}, ${y})` });
};

// Set DPI scale for coordinate conversion
const setDpiScale = (scale) => {
    dpiScale = scale;
    console.log(`DPI scale set to ${scale}`);
    ioInstance?.emit('log', { message: `DPI scale set to ${scale}` });
};

module.exports = {
    init,
    startAgent,
    setMacroMode,
    typeText,
    pressKey,
    stopInputLoop,
    restartTerminal,
    mouseClick,
    mouseMove,
    startAutoAccept,
    stopAutoAccept,
    setScreenOffset,
    setDpiScale
};
