const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');

const log = (msg) => {
    console.log(msg);
    try { fs.appendFileSync('blob_diag.log', msg + '\n'); } catch (e) { }
};

(async () => {
    try {
        log("Loading diagnostic_screen_dump.png...");
        const image = await Jimp.read('diagnostic_screen_dump.png');
        const w = image.bitmap.width;
        const h = image.bitmap.height;
        log(`Image loaded: ${w}x${h}`);

        // Search for "Red" blob (BGR Blue)
        // Adjust threshold as needed. Blue button in BGR is Red ~255, G ~dynamic, B ~dynamic.
        // Or simply looking for dominant color.
        // Let's look for a run of 20 pixels that are "Red-ish".

        let foundX = -1, foundY = -1;

        image.scan(0, 0, w, h, (x, y, idx) => {
            if (foundX !== -1) return; // Stop if found

            const r = image.bitmap.data[idx];
            const g = image.bitmap.data[idx + 1];
            const b = image.bitmap.data[idx + 2];

            // Heuristic for BGR Blue: High R, Low G/B
            // Windows Accept Button Blue is roughly R=0, G=120, B=215 (RGB).
            // In BGR: R=215, G=120, B=0.
            // So looking for R > 150, G < 150, B < 100.
            if (r > 150 && g > 80 && g < 180 && b < 100) {
                // Potential hit. Check if it's a "blob" (check neighbor +20px x)
                // This is a naive check to avoid noise.
                // Or just save the first valid one for now?
                // Let's count matching pixels in a row.
                let consecutive = 0;
                for (let k = 0; k < 50; k++) {
                    if (x + k >= w) break;
                    const idx2 = image.getPixelIndex(x + k, y);
                    const r2 = image.bitmap.data[idx2];
                    const g2 = image.bitmap.data[idx2 + 1];
                    const b2 = image.bitmap.data[idx2 + 2];
                    if (r2 > 150 && g2 > 80 && g2 < 180 && b2 < 100) {
                        consecutive++;
                    }
                }

                if (consecutive > 30) {
                    foundX = x;
                    foundY = y;
                }
            }
        });

        if (foundX !== -1) {
            log(`Found candidate at ${foundX}, ${foundY}`);
            // Crop a region around it. Assuming button is ~100x40
            // We found the start, so let's crop starting there.
            // Add some padding or center it?
            // "Accept all" button is likely 120x35 px.
            const cropX = foundX;
            const cropY = Math.max(0, foundY - 5);
            const cropW = 120;
            const cropH = 40;

            const template = image.clone().crop(cropX, cropY, cropW, cropH);
            await template.writeAsync('extracted_template.png');
            log("Saved extracted_template.png");
        } else {
            log("No red blob found matching criteria.");
        }

    } catch (e) {
        log(`Error: ${e}`);
    }
})();
