const CANVAS_WIDTH = 128;
const CANVAS_HEIGHT = 64;
const THRESHOLD = 128;
let canvas;
let imageLoadId = 0;

function setImage(file) {
  if (!file) return;

  const error = document.getElementById('only-images-file-error');
  const output = document.getElementById('code-output');
  const status = document.getElementById('copy-status');

  error.style.display = 'none';
  if (!file.type.startsWith('image/')) {
    error.textContent = 'Choose a valid image file.';
    error.style.display = 'block';
    return;
  }

  const loadId = ++imageLoadId;
  output.value = '';
  status.textContent = '';
  document.getElementById('generate-button').disabled = true;
  document.getElementById('copy-button').disabled = true;
  document.getElementById('selected-file').textContent = file.name;
  const preview = document.getElementById('images-canvas-container');
  preview.replaceChildren();
  document.getElementById('preview-placeholder').style.display = '';
  canvas = null;

  const imageUrl = URL.createObjectURL(file);
  const image = new Image();

  image.onload = () => {
    URL.revokeObjectURL(imageUrl);
    if (loadId !== imageLoadId) return;

    canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.drawImage(image, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    dithering(context, CANVAS_WIDTH, CANVAS_HEIGHT, THRESHOLD, 0);

    preview.replaceChildren(canvas);
    document.getElementById('preview-placeholder').style.display = 'none';
    document.getElementById('generate-button').disabled = false;
    document.getElementById('copy-button').disabled = false;
    document.getElementById('file-input').value = '';
  };

  image.onerror = () => {
    URL.revokeObjectURL(imageUrl);
    if (loadId !== imageLoadId) return;

    error.textContent = 'This image could not be opened. Try another file.';
    error.style.display = 'block';
    document.getElementById('selected-file').textContent = 'No image selected';
    document.getElementById('file-input').value = '';
  };

  image.src = imageUrl;
}

function generateOutput() {
  if (!canvas) return;

  const selectedFormat = document.querySelector('.format-button[aria-pressed="true"]')?.dataset.format;
  const formatSettings = {
    arduino: { sda: 'A4', scl: 'A5' },
    esp8266: { sda: 'D2', scl: 'D1' },
    esp32: { sda: '21', scl: '22' },
  };
  if (!(selectedFormat in formatSettings)) {
    document.getElementById('code-output').value = '';
    document.getElementById('copy-status').textContent = 'Select a code format.';
    return;
  }

  const pixels = canvas.getContext('2d').getImageData(
    0,
    0,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
  ).data;
  const rows = [];

  for (let y = 0; y < CANVAS_HEIGHT; y += 1) {
    const bytes = [];
    for (let x = 0; x < CANVAS_WIDTH; x += 8) {
      let value = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const pixelIndex = (y * CANVAS_WIDTH + x + bit) * 4;
        if (pixels[pixelIndex] >= THRESHOLD) {
          value |= 1 << (7 - bit);
        }
      }
      bytes.push(`0x${value.toString(16).padStart(2, '0')}`);
    }
    rows.push(`  ${bytes.join(', ')}`);
  }

  const filename = document.getElementById('selected-file').textContent;
  const glyph = filename
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9]/g, '_') || 'bitmap';
  const identifier = `epd_bitmap_${glyph}`;
  const pins = formatSettings[selectedFormat];
  const pinDefinitions = pins
    ? `\n#define OLED_SDA ${pins.sda}\n#define OLED_SCL ${pins.scl}\n`
    : '';
  const wireBegin = selectedFormat === 'arduino'
    ? '  Wire.begin();\n\n'
    : '  Wire.begin(OLED_SDA, OLED_SCL);\n\n';
  const output = `#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

#define OLED_RESET -1
#define SCREEN_ADDRESS 0x3C
${pinDefinitions}

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

const unsigned char ${identifier} [] PROGMEM = {
${rows.join(',\n')}
};

void setup() {
${wireBegin}  if(!display.begin(SSD1306_SWITCHCAPVCC, SCREEN_ADDRESS)) {
    for(;;);
  }

  display.clearDisplay();
  display.drawBitmap(0, 0, ${identifier}, ${CANVAS_WIDTH}, ${CANVAS_HEIGHT}, WHITE);
  display.display();
}

void loop() {
}`;

  document.getElementById('code-output').value = output;
  document.getElementById('copy-status').textContent = '';
}

async function copyOutput() {
  if (!canvas) return;

  const output = document.getElementById('code-output');
  if (!output.value) {
    generateOutput();
    if (!output.value) return;
  }

  const status = document.getElementById('copy-status');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(output.value);
    } else {
      output.focus();
      output.select();
      if (!document.execCommand('copy')) {
        throw new Error('Clipboard access is unavailable');
      }
    }
    status.textContent = 'Code copied to clipboard.';
  } catch (error) {
    output.focus();
    output.select();
    status.textContent = `${error.message}. Select the code and copy it manually.`;
  }
}

document.getElementById('file-input').addEventListener('change', (event) => {
  setImage(event.target.files[0]);
});
document.getElementById('generate-button').addEventListener('click', generateOutput);
document.getElementById('copy-button').addEventListener('click', copyOutput);
document.querySelectorAll('.format-button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.format-button').forEach((formatButton) => {
      const isSelected = formatButton === button;
      formatButton.classList.toggle('is-selected', isSelected);
      formatButton.setAttribute('aria-pressed', String(isSelected));
    });
    document.getElementById('code-output').value = '';
    document.getElementById('copy-status').textContent = '';
  });
});
