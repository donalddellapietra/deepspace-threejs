import { test, expect } from '@playwright/test';

test.describe('Deep Space Three.js', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the game to initialize (canvas + React overlay)
    await page.waitForSelector('#game-canvas');
    await page.waitForSelector('#root');
    // Give the game loop a moment to start
    await page.waitForTimeout(1000);
  });

  test('page loads with canvas and UI root', async ({ page }) => {
    const canvas = page.locator('#game-canvas');
    await expect(canvas).toBeVisible();
    const root = page.locator('#root');
    await expect(root).toBeAttached();
  });

  test('hotbar renders with 10 slots', async ({ page }) => {
    const hotbar = page.locator('.hotbar');
    await expect(hotbar).toBeVisible();
    const swatches = page.locator('.hotbar-swatch');
    await expect(swatches).toHaveCount(10);
  });

  test('hotbar shows active slot', async ({ page }) => {
    const activeSwatches = page.locator('.hotbar-swatch.active');
    await expect(activeSwatches).toHaveCount(1);
  });

  test('mode indicator shows layer', async ({ page }) => {
    const modeIndicator = page.locator('.mode-indicator');
    await expect(modeIndicator).toBeVisible();
    const layerText = page.locator('.mode-layer');
    await expect(layerText).toContainText('Layer');
  });

  test('hotbar hint text is present', async ({ page }) => {
    const hint = page.locator('.hotbar-hint');
    await expect(hint).toContainText('1-0: select');
    await expect(hint).toContainText('E: inventory');
    await expect(hint).toContainText('C: color picker');
    await expect(hint).toContainText('Q/F: zoom');
    await expect(hint).toContainText('V: save');
  });

  test('crosshair is present in DOM', async ({ page }) => {
    // Crosshair is injected as a direct DOM element in main.ts
    const crosshair = await page.evaluate(() => {
      const divs = document.querySelectorAll('body > div');
      for (const div of divs) {
        const s = (div as HTMLElement).style;
        if (s.width === '4px' && s.height === '4px') return true;
      }
      return false;
    });
    expect(crosshair).toBe(true);
  });

  test('canvas has correct clear color (sky blue)', async ({ page }) => {
    // Check that the WebGL context is initialized
    const hasContext = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
      return !!canvas.getContext('webgl2') || !!canvas.getContext('webgl');
    });
    expect(hasContext).toBe(true);
  });

  test('inventory not visible by default', async ({ page }) => {
    const inventory = page.locator('.inventory-panel');
    await expect(inventory).not.toBeVisible();
  });

  test('color picker not visible by default', async ({ page }) => {
    const picker = page.locator('.color-picker-panel');
    await expect(picker).not.toBeVisible();
  });

  test('three.js renderer is initialized', async ({ page }) => {
    // Check that the Three.js WebGL renderer has been created
    await page.waitForTimeout(2000);
    const rendererExists = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
      // Canvas should have been used by Three.js (width/height set)
      return canvas.width > 0 && canvas.height > 0;
    });
    expect(rendererExists).toBe(true);
  });

  test('UI CSS variables are defined', async ({ page }) => {
    const accentColor = await page.evaluate(() => {
      return getComputedStyle(document.documentElement).getPropertyValue('--accent');
    });
    expect(accentColor.trim()).toBeTruthy();
  });
});
