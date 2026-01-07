const { screen, imageResource, sleep } = require('@nut-tree-fork/nut-js');
const Jimp = require('jimp');
const path = require('path');
const fs = require('fs');

screen.config.resourceDirectory = __dirname;
screen.config.confidence = 0.6;

const log = (msg) => {
    console.log(msg);
    try { fs.appendFileSync('diag.log', msg + '\n'); } catch (e) { }
};

(async () => {
    log("Starting Multi-Scale Diagnostic...");
    try { fs.unlinkSync('diag.log'); } catch (e) { }

    try {
        const scales = [0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5];
        const baseTemplate = 'assets/accept_all_bgr.png'; // Use the color-corrected one

        const image = await Jimp.read(path.join(__dirname, baseTemplate));

        for (const scale of scales) {
            const scaledName = `temp_scale_${scale}.png`;
            const w = image.bitmap.width * scale;
            const h = image.bitmap.height * scale;

            const resized = image.clone().resize(w, h);
            await resized.writeAsync(path.join(__dirname, scaledName));

            log(`Testing scale ${scale} for ${baseTemplate}...`);
            try {
                // We use full path or relative to CWD if resourceDirectory is set to __dirname
                const region = await screen.find(imageResource(scaledName));
                log(`SUCCESS: Found match at scale ${scale} at (${region.left}, ${region.top})`);
                // Break on first success? No, let's see which is best or if multiple match
            } catch (e) {
                log(`FAILED: Scale ${scale}`);
            }

            // Cleanup
            try { fs.unlinkSync(path.join(__dirname, scaledName)); } catch (e) { }
        }

    } catch (e) {
        log(`Diagnostic Error: ${e}`);
    }
})();
