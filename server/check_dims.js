const Jimp = require('jimp');
const path = require('path');

(async () => {
    const files = ['accept_button1.jpg', 'accept_all_new.png'];

    for (const file of files) {
        try {
            const p = path.join(__dirname, 'assets', file);
            const img = await Jimp.read(p);
            console.log(`${file}: ${img.bitmap.width}x${img.bitmap.height}`);
        } catch (e) {
            console.error(`Error reading ${file}:`, e);
        }
    }
})();
