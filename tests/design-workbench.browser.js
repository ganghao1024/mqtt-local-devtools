async page => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const failedResources = []; page.on('response', response => { if (response.status() >= 400) failedResources.push(response.url()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:8174/tests/analysis-panel.html');
  await page.addScriptTag({ url: 'http://127.0.0.1:8174/tests/analysis-matrix-demo.js' });
  await page.waitForFunction(() => !document.querySelector('#analysisExportCombined').disabled);
  const visibleContrast = async selector => page.locator(selector).first().evaluate(element => {
    const foreground = getComputedStyle(element).color.match(/[\d.]+/g).slice(0, 3).map(Number);
    let background = [0, 0, 0];
    for (let parent = element; parent; parent = parent.parentElement) {
      const rgba = getComputedStyle(parent).backgroundColor.match(/[\d.]+/g).map(Number);
      if (rgba.length === 3 || rgba[3] === 1) { background = rgba.slice(0, 3); break; }
    }
    const luminance = color => color.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  });
  const contrastResults = {};
  for (const selector of ['#analysisSelectLatest', '#analysisFreezeStatus', '.analysis-cache-status', '.matrix-cell-changed', '.matrix-cell-missing', '.module-tab.selected']) {
    contrastResults[selector] = +(await visibleContrast(selector)).toFixed(2);
    assert(contrastResults[selector] >= 4.5, selector + ' contrast');
  }
  assert(await page.locator('#analysisChangesTable').evaluate(el => el.clientHeight >= 200), 'analysis result retains a usable viewport with the additional sample-data banner');
  await page.screenshot({ path: '.playwright-cli/design-analysis.png' });
  await page.locator('#analysisModuleButton').focus(); await page.keyboard.press('Home');
  assert(await page.locator('#mqttModuleButton').evaluate(el => document.activeElement === el && el.getAttribute('aria-selected') === 'true'), 'module Home selects and focuses MQTT');
  await page.keyboard.press('ArrowRight');
  assert(await page.locator('#httpWorkspace').isVisible() && await page.locator('#httpModuleButton').evaluate(el => document.activeElement === el), 'module arrow navigation preserves focus');
  await page.keyboard.press('End');
  assert(await page.locator('#analysisWorkspace').isVisible(), 'module End selects analysis');
  await page.locator('#analysisSelectLatest').focus();
  assert(await page.locator('#analysisSelectLatest').evaluate(el => getComputedStyle(el).outlineStyle !== 'none'), 'keyboard focus visible');
  const matrixIds = await page.locator('.analysis-matrix-table tbody tr').evaluateAll(rows => rows.map(row => row.dataset.matrixId));
  for (const [width, height] of [[1280, 720], [900, 800], [640, 800]]) {
    await page.setViewportSize({ width, height });
    for (const module of ['analysis', 'http', 'mqtt']) {
      await page.locator('#' + module + 'ModuleButton').click();
      const size = await page.locator('#' + module + 'Workspace').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
      assert(size.scroll <= size.client + 1, module + ' workspace overflow at ' + width + ': ' + JSON.stringify(size));
      assert(await page.locator('.app-header').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'header fits ' + width);
      if (module === 'mqtt') assert(await page.locator('.filters-bar').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'filters wrap without horizontal scroll');
      if (module === 'analysis') assert(JSON.stringify(await page.locator('.analysis-matrix-table tbody tr').evaluateAll(rows => rows.map(row => row.dataset.matrixId))) === JSON.stringify(matrixIds), 'responsive matrix retains every row and order');
    }
    await page.locator('#analysisModuleButton').click();
    await page.screenshot({ path: '.playwright-cli/design-analysis-' + width + '.png' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#mqttModuleButton').click();
  await page.locator('[data-render-key="demo-a-3"]').click();
  assert(await page.locator('#packetRows tr[data-render-key]').first().evaluate(el => Math.abs(el.getBoundingClientRect().height - 46) < 1), 'MQTT row height still matches virtual window');
  await page.locator('#detailsSearchInput').fill('battery');
  assert((await page.locator('#detailsSearchCount').innerText()) === '1/1', 'detail keyword search intact');
  await page.screenshot({ path: '.playwright-cli/design-mqtt.png' });
  await page.locator('#httpModuleButton').click();
  await page.locator('#curlInput').fill("curl 'http://127.0.0.1:8174/echo?device=A' -H 'Accept: application/json'");
  await page.locator('#parseCurlButton').click(); await page.locator('#sendHttpButton').click();
  await page.waitForFunction(() => document.querySelector('#responseStatusBadge').textContent.includes('200'));
  await page.locator('#httpTopResizer').focus();
  const before = await page.locator('#curlImportCard').evaluate(el => el.getBoundingClientRect().height);
  await page.keyboard.press('ArrowDown');
  assert(await page.locator('#curlImportCard').evaluate(el => el.getBoundingClientRect().height) > before, 'HTTP resizer still works');
  await page.screenshot({ path: '.playwright-cli/design-http.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert(await page.locator('#sendHttpButton').evaluate(el => parseFloat(getComputedStyle(el).transitionDuration) <= .001), 'reduced-motion preference respected');
  await page.addInitScript(() => { window.chrome = { tabs: { query: async () => [{ url: 'http://localhost:4300/debug/device/A' }] } }; });
  await page.setViewportSize({ width: 340, height: 450 });
  await page.goto('http://127.0.0.1:8174/popup.html');
  await page.waitForFunction(() => document.querySelector('#site').textContent.includes('http://localhost:4300'));
  assert(await page.locator('body').evaluate(el => el.scrollWidth <= el.clientWidth), 'popup fits its fixed width');
  assert(await page.locator('.update-link').evaluate(el => el.getBoundingClientRect().height >= 36), 'popup link has a usable target');
  await page.screenshot({ path: '.playwright-cli/design-popup.png' });
  assert(errors.length === 0, errors.join('; '));
  assert(failedResources.length === 0, failedResources.join('; '));
  return { passed: ['shared real-page theme', 'computed contrast', 'result viewport', 'module keyboard navigation', 'visible focus', '1280/900/640 layouts', 'wrapped filters', 'stable matrix rows', 'virtual row height', 'detail search', 'HTTP request and resizer', 'reduced motion', 'popup and local assets'], contrastResults };
}
