const Jimp = require('jimp');
const path = require('path');

const convert = async (filename, outputName) => {
    try {
        const image = await Jimp.read(path.join(__dirname, 'assets', filename));

        // Swap Red and Blue channels
        image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
            const red = image.bitmap.data[idx];
            const blue = image.bitmap.data[idx + 2];

            image.bitmap.data[idx] = blue; // R = old B
            image.bitmap.data[idx + 2] = red; // B = old R
        });

        await image.writeAsync(path.join(__dirname, 'assets', outputName));
        console.log(`Created ${outputName}`);
    } catch (e) {
        console.error(`Failed to convert ${filename}:`, e);
    }
};

(async () => {
    await convert('accept_all_new.png', 'accept_all_bgr.png');
    await convert('accept_button1.jpg', 'accept_button1_bgr.jpg');
})();
