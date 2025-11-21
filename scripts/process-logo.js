import { Jimp } from 'jimp';

async function processImage() {
    try {
        // Read the original generated image for Option 2
        const imagePath = 'C:/Users/eric.pallares/.gemini/antigravity/brain/367dbbef-46f6-4aaa-ad48-6ee722904060/compass_simple_2_1763752919997.png';
        const image = await Jimp.read(imagePath);

        // Scan every pixel
        image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
            const red = this.bitmap.data[idx + 0];
            const green = this.bitmap.data[idx + 1];
            const blue = this.bitmap.data[idx + 2];

            // If pixel is white (or very close to white), make it transparent
            if (red > 240 && green > 240 && blue > 240) {
                this.bitmap.data[idx + 3] = 0; // Set alpha to 0
            }
        });

        // Save as logo.png and favicon.png in public folder
        await image.write('public/logo.png');
        await image.write('public/favicon.png');

        console.log('Successfully processed logo and saved to public/');
    } catch (error) {
        console.error('Error processing image:', error);
    }
}

processImage();
