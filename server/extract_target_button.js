const { screen } = require('@nut-tree-fork/nut-js');
const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');

const log = (msg) => {
    console.log(msg);
    try { fs.appendFileSync('extract_log.txt', msg + '\n'); } catch (e) { }
};

(async () => {
    try {
        log("Starting Targeted Extraction...");

        // Define region around user's hint (1450, 713)
        // Screen width is 1536. 1450 is close to right edge.
        // Capture a safe area around it that fits in screen.
        const captureRegion = { left: 1350, top: 660, width: 180, height: 100 };
        log(`Capturing region: ${JSON.stringify(captureRegion)}`);

        const grab = await screen.grabRegion(captureRegion);
        const image = new Jimp({ data: grab.data, width: grab.width, height: grab.height });

        // Save for debug
        await image.writeAsync('debug_target_area.png');
        log("Saved debug_target_area.png (physical matching extraction)");

        // Scan for the blue button (Red in BGR)
        const w = image.bitmap.width;
        const h = image.bitmap.height;
        let foundX = -1, foundY = -1;

        // Heuristic: specific "Red" (BGR Blue) color of standard Windows buttons
        // Accept All button usually has text white.
        // We look for a patch of color.

        image.scan(0, 0, w, h, (x, y, idx) => {
            if (foundX !== -1) return;

            const r = image.bitmap.data[idx];     // Blue channel in RGB, but Red in BGR
            const g = image.bitmap.data[idx + 1];
            const b = image.bitmap.data[idx + 2]; // Red channel in RGB, but Blue in BGR

            // BGR Blue: R=High, G=Med, B=Low
            if (r > 160 && g > 80 && g < 180 && b < 80) {
                // Found a start pixel. Check for a horizontal run to confirm it's a button.
                let run = 0;
                for (let k = 0; k < 20; k++) {
                    if (x + k >= w) break;
                    const i2 = image.getPixelIndex(x + k, y);
                    const r2 = image.bitmap.data[i2];
                    if (r2 > 160) run++;
                }
                if (run > 15) {
                    foundX = x;
                    foundY = y;
                }
            }
        });

        if (foundX !== -1) {
            log(`Found button blob at local coords: ${foundX}, ${foundY}`);
            // Crop the button. 
            // "Accept all" is roughly 100x30.
            // foundX is the left edge (probably).
            // Let's crop slightly before it to be safe? 
            // Better to crop exactly if we found the edge.

            const cropX = foundX;
            const cropY = Math.max(0, foundY - 5);
            const cropW = 110;
            const cropH = 40;

            const template = image.clone().crop(cropX, cropY, cropW, cropH);
            await template.writeAsync('assets/final_template.png');
            log("Saved assets/final_template.png");
        } else {
            log("No button color found. Performing BLIND CROP at user coordinates.");
            // User said 1450, 713.
            // Region started at 1350, 660.
            // Relative center: X=100, Y=53.
            // Crop a 100x30 box centered there.
            const cropX = 50;
            const cropY = 38;
            const cropW = 100;
            const cropH = 30;

            const template = image.clone().crop(cropX, cropY, cropW, cropH);
            await template.writeAsync('assets/final_template.png');
            log("Saved assets/final_template.png (Force Crop)");
        }

    } catch (e) {
        log(`Error: ${e}`);
    }
})();
