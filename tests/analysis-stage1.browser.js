async page => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  await page.goto('http://127.0.0.1:8174/tests/analysis-panel.html');
  await page.locator('#mqttModuleButton').click();
  await page.evaluate(() => {
    const make = (id, value, topic = 'shared') => ({ id, kind: 'packet', timestamp: Date.now(), connectionId: 'c', direction: 'incoming',
      packet: { typeName: 'PUBLISH', topic, qos: 1, retain: false, dup: false, payloadEncoding: 'utf-8', payloadText: JSON.stringify(value) } });
    mqttHarness.emit([make('a1', { device: 'A', nested: { gone: null, value: 0 } }), make('b1', { device: 'B', nested: { value: 99 } }, 'other'),
      make('a2', { device: 'A', nested: { added: false, value: '0' } })]);
  });
  await page.locator('[data-render-key="a2"]').click();
  await page.locator('#quickComparePrevious').click();
  assert(await page.locator('#analysisSettings, #analysisConfigure, #analysisDevicePath').count() === 0, 'production panel has no advanced settings');
  const objects = await page.locator('#compareObjects').innerText();
  assert(objects.includes('#1') && objects.includes('#3') && !objects.includes('#2'), 'automatic predecessor uses complete Topic without setup');
  const diff = await page.locator('#diffResults').innerText();
  assert(diff.includes('/nested/gone') && diff.includes('/nested/added') && diff.includes('/nested/value') && diff.includes('删除'), 'nested diff');
  await page.locator('#comparePin').click();
  await page.locator('#mqttModuleButton').click();
  await page.locator('[data-render-key="a1"]').click();
  await page.locator('#quickAddAnalysis').click();
  await page.locator('#compareManual').click();
  assert((await page.locator('#compareObjects').innerText()).includes('手动比较'), 'manual comparison within complete Topic');
  await page.locator('#compareContext').evaluate(el => el.open = true);
  assert((await page.locator('#compareContextText').innerText()).includes('"retain": false'), 'full context metadata');
  await page.screenshot({ path: '.playwright-cli/analysis-diff.png' });
  return { passed: ['no advanced settings', 'automatic Topic identity', 'sibling Topic isolation', 'nested and typed diff', 'manual comparison', 'full context'] };
}
