const Jimp = require('jimp');
const path = require('path');

(async () => {
    try {
        const inputPath = path.join(__dirname, 'assets', 'final_template.png');
        const outputPath = path.join(__dirname, 'assets', 'final_template_0.8x.png');

        console.log(`Loading ${inputPath}...`);
        const image = await Jimp.read(inputPath);

        // Resize to 80% (to match 1.25x scaling: 1 / 1.25 = 0.8)
        const newWidth = image.bitmap.width * 0.8;
        const newHeight = image.bitmap.height * 0.8;

        console.log(`Resizing from ${image.bitmap.width}x${image.bitmap.height} to ${newWidth}x${newHeight}`);

        image.resize(newWidth, newHeight);
        await image.writeAsync(outputPath);

        console.log(`Saved ${outputPath}`);
    } catch (e) {
        console.error("Error resizing image:", e);
    }
})();
