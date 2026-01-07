const Jimp = require('jimp');
const path = require('path');

const processImage = async (filename) => {
    try {
        const inputPath = path.join(__dirname, 'assets', filename);
        console.log(`Processing ${filename}...`);

        const image = await Jimp.read(inputPath);
        const w = image.bitmap.width;
        const h = image.bitmap.height;

        // 1. Generate 1.25x (Upscale for High DPI)
        const upscale = image.clone().resize(w * 1.25, h * 1.25);
        const upscaleName = filename.replace(/\.(.+)$/, '_1.25x.$1');
        await upscale.writeAsync(path.join(__dirname, 'assets', upscaleName));
        console.log(`Saved ${upscaleName}`);

        // 2. Generate BGR for Original
        const bgrOriginal = image.clone();
        swapChannels(bgrOriginal);
        const bgrName = filename.replace(/\.(.+)$/, '_bgr.$1');
        await bgrOriginal.writeAsync(path.join(__dirname, 'assets', bgrName));
        console.log(`Saved ${bgrName}`);

        // 3. Generate BGR for Upscale
        const bgrUpscale = upscale.clone();
        swapChannels(bgrUpscale);
        const bgrUpscaleName = filename.replace(/\.(.+)$/, '_1.25x_bgr.$1');
        await bgrUpscale.writeAsync(path.join(__dirname, 'assets', bgrUpscaleName));
        console.log(`Saved ${bgrUpscaleName}`);

    } catch (e) {
        console.error(`Failed ${filename}:`, e);
    }
};

const swapChannels = (img) => {
    img.scan(0, 0, img.bitmap.width, img.bitmap.height, (x, y, idx) => {
        const r = img.bitmap.data[idx];
        const b = img.bitmap.data[idx + 2];
        img.bitmap.data[idx] = b;
        img.bitmap.data[idx + 2] = r;
    });
};

(async () => {
    await processImage('accept_button1.jpg');
    // accept_all_new.png might be broken or missing, checking simple one first
    await processImage('accept_all_new.png');
})();
