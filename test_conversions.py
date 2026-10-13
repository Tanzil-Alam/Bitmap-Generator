#!/usr/bin/env python3
"""Browser tests for the fixed 128x64 Arduino bitmap workflow."""
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image
from playwright.sync_api import Error, sync_playwright

ROOT = Path(__file__).parent.parent
INDEX_HTML = ROOT / "index.html"
TEST_IMAGE = Path(__file__).parent / "fixtures" / "test_pattern.png"


class BitmapGeneratorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        try:
            cls.browser = cls.playwright.chromium.launch()
        except Error:
            if sys.platform != "win32":
                raise
            edge_paths = [
                Path(os.environ.get("PROGRAMFILES(X86)", ""))
                / "Microsoft"
                / "Edge"
                / "Application"
                / "msedge.exe",
                Path(os.environ.get("PROGRAMFILES", ""))
                / "Microsoft"
                / "Edge"
                / "Application"
                / "msedge.exe",
            ]
            edge_path = next((path for path in edge_paths if path.is_file()), None)
            if edge_path is None:
                raise
            cls.browser = cls.playwright.chromium.launch(executable_path=str(edge_path))
        cls.context = cls.browser.new_context()
        cls.context.add_init_script(
            """Object.defineProperty(navigator, 'clipboard', {
              configurable: true,
              value: { writeText: async (text) => { window.__clipboardText = text; } }
            });"""
        )
        cls.page = cls.context.new_page()

    @classmethod
    def tearDownClass(cls):
        cls.context.close()
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page.goto(INDEX_HTML.as_uri())

    def load_test_image(self):
        self.page.locator("#file-input").set_input_files(str(TEST_IMAGE))
        self.page.wait_for_function(
            "document.querySelector('#images-canvas-container canvas')?.width === 128"
        )

    def test_fixed_canvas_arduino_output_and_copy(self):
        self.assertEqual(self.page.locator("select").count(), 0)
        self.assertTrue(self.page.locator("#generate-button").is_disabled())
        self.assertTrue(self.page.locator("#copy-button").is_disabled())

        self.load_test_image()
        self.assertEqual(
            self.page.locator("#images-canvas-container canvas").evaluate(
                "(canvas) => [canvas.width, canvas.height]"
            ),
            [128, 64],
        )
        self.assertEqual(
            self.page.locator("#images-canvas-container canvas").evaluate(
                "(canvas) => { const ctx = canvas.getContext('2d'); "
                "return [ctx.getImageData(0, 0, 1, 1).data[0], "
                "ctx.getImageData(127, 0, 1, 1).data[0], "
                "ctx.getImageData(127, 63, 1, 1).data[0]]; }"
            ),
            [0, 255, 0],
        )
        self.assertEqual(
            self.page.locator("#images-canvas-container canvas").evaluate(
                "(canvas) => { const r = canvas.getBoundingClientRect(); "
                "return [r.width > 128, r.height > 64, Math.abs(r.width / r.height - 2) < 0.05]; }"
            ),
            [True, True, True],
        )
        self.assertTrue(self.page.locator("#generate-button").is_enabled())
        self.assertIn("test_pattern.png", self.page.locator("#selected-file").inner_text())

        self.page.locator("#generate-button").click()
        output = self.page.locator("#code-output").input_value()
        self.assertIn("// 'test_pattern', 128x64px", output)
        self.assertIn("const unsigned char epd_bitmap_test_pattern [] PROGMEM = {", output)
        self.assertIn("const int epd_bitmap_allArray_LEN = 1;", output)
        self.assertIn("Total bytes used to store images in PROGMEM = 1024", output)
        self.assertEqual(len(re.findall(r"0x[0-9a-fA-F]{2}", output)), 1024)

        self.page.locator("#copy-button").click()
        self.page.wait_for_function("window.__clipboardText === document.querySelector('#code-output').value")
        self.assertIn("Code copied", self.page.locator("#copy-status").inner_text())

    def test_replacing_image_clears_old_output(self):
        self.load_test_image()
        self.page.locator("#generate-button").click()
        self.assertNotEqual(self.page.locator("#code-output").input_value(), "")

        with tempfile.TemporaryDirectory() as temp_dir:
            replacement = Path(temp_dir) / "white.png"
            Image.new("RGB", (1, 1), "white").save(replacement)
            self.page.locator("#file-input").set_input_files(str(replacement))
            self.page.wait_for_function(
                "document.querySelector('#selected-file').textContent === 'white.png' "
                "&& document.querySelector('#images-canvas-container canvas')?.width === 128"
            )

        self.assertEqual(self.page.locator("#code-output").input_value(), "")
        self.page.locator("#generate-button").click()
        output = self.page.locator("#code-output").input_value()
        self.assertIn("// 'white', 128x64px", output)
        self.assertEqual(len(re.findall(r"0x[0-9a-fA-F]{2}", output)), 1024)

    def test_rejects_non_image_files(self):
        self.page.locator("#file-input").set_input_files(
            {"name": "not-an-image.txt", "mimeType": "text/plain", "buffer": b"not an image"}
        )
        self.assertTrue(self.page.locator("#only-images-file-error").is_visible())
        self.assertTrue(self.page.locator("#generate-button").is_disabled())

    def test_mobile_layout_keeps_the_workflow_in_order(self):
        self.page.set_viewport_size({"width": 390, "height": 844})
        upload_top = self.page.locator(".upload-card").evaluate("(el) => el.getBoundingClientRect().top")
        preview_top = self.page.locator(".preview-card").evaluate("(el) => el.getBoundingClientRect().top")
        output_top = self.page.locator(".output-card").evaluate("(el) => el.getBoundingClientRect().top")
        self.assertLess(upload_top, preview_top)
        self.assertLess(preview_top, output_top)


if __name__ == "__main__":
    unittest.main()
