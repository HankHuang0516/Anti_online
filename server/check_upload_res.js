const Jimp = require('jimp');
const path = require('path');

(async () => {
    // Check the uploaded artifact image
    const p = "C:/Users/z004rx2h/.gemini/antigravity/brain/17e671ef-3fb4-4199-91cd-fa934380a76c/uploaded_image_1767702297648.png";
    try {
        const img = await Jimp.read(p);
        console.log(`Uploaded Image Resolution: ${img.bitmap.width}x${img.bitmap.height}`);
    } catch (e) {
        console.error("Error reading image:", e);
    }
})();
