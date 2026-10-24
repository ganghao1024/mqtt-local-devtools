async page => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8174/tests/analysis-panel.html');
  await page.locator('#analysisModuleButton').click();
  assert(await page.locator('#analysisSelectLatest').isDisabled(), 'scope required before latest analysis');
  await page.evaluate(() => {
    window.scopeEvent = (id, topic, value = 0, device = 'A') => ({ id, kind: 'packet', timestamp: Date.now(), connectionId: 'c', direction: 'incoming', packet: { typeName: 'PUBLISH', topic, qos: 1, retain: true, dup: false, payloadText: JSON.stringify({ device, value }) } });
    mqttHarness.emit([
      scopeEvent('a1', 'site/device/state/osd', 0), scopeEvent('b1', 'other/device/state/osd', 90),
      scopeEvent('a-other-device', 'site/device/state/osd', 100, 'B'), scopeEvent('a2', 'site/device/state/osd', 1),
      scopeEvent('a-info', 'site/device/state/info', 10), scopeEvent('near-prefix', 'site/device/state2/osd', 50),
      scopeEvent('a3', 'site/device/state/osd', 0), scopeEvent('b2', 'other/device/state/osd', 99)
    ]);
  });
  await page.waitForFunction(() => document.querySelector('#analysisTopicGroup').options.length === 5);
  assert(await page.locator('#analysisSelectLatest').isDisabled(), 'arriving topics never silently select all or first group');
  await page.locator('#mqttModuleButton').click();
  await page.locator('#addFilteredToAnalysis').click();
  assert(await page.locator('[data-analysis-id]').count() === 0 && await page.locator('#analysisSelectLatest').isDisabled(), 'unscoped bulk selection requires explicit group');
  await page.locator('#mqttModuleButton').click();
  await page.getByRole('button', { name: '展开 site/device/state', exact: true }).click();
  await page.getByRole('button', { name: '分析完整 Topic site/device/state/osd', exact: true }).click();
  assert(await page.locator('#analysisTopicGroup').inputValue() === 'site/device/state/osd', 'sidebar analyzes exactly clicked group');
  assert(await page.locator('#analysisSettings, #analysisConfigure').count() === 0, 'production has no advanced setup');
  await page.locator('#analysisLatestCount').fill('3'); await page.locator('#analysisSelectLatest').click();
  await page.waitForFunction(() => !document.querySelector('#analysisExportCombined').disabled);
  let ids = await page.locator('[data-analysis-id]').evaluateAll(nodes => nodes.map(node => node.dataset.analysisId));
  assert(JSON.stringify(ids) === JSON.stringify(['a3', 'a2', 'a-other-device']), 'latest N filters group first and excludes newer other groups');
  await page.locator('#analysisLatestCount').fill('10'); await page.locator('#analysisSelectLatest').click();
  await page.waitForFunction(() => !document.querySelector('#analysisExportCombined').disabled);
  const summary = await page.locator('#analysisResultSummary').innerText();
  const statistics = await page.locator('#analysisSkippedRows').textContent();
  assert(summary.includes('4 条消息') && statistics.includes('1 个对象') && statistics.includes('3 次相邻比较'), 'complete Topic defines one device regardless of payload fields');
  assert((await page.locator('#analysisNotice').innerText()).includes('缓存不足'), 'insufficient group never fills from other groups');
  for (const [mode, button] of [['changes', 'analysisExportChanges'], ['raw', 'analysisExportRaw'], ['combined', 'analysisExportCombined']]) {
    const promise = page.waitForEvent('download'); await page.locator('#' + button).click(); const download = await promise;
    await download.saveAs('.playwright-cli/analysis-topic-' + mode + '.json');
    const stream = await download.createReadStream(); let text = ''; for await (const chunk of stream) text += chunk.toString('utf8');
    const value = JSON.parse(text);
    assert(value.config.topic === 'site/device/state/osd' && value.config.topicGroup === 'site/device/state' && value.config.topicGroupDepth === 3 && value.config.packetType === 'PUBLISH', 'scope and rule exported');
    assert(value.selection.length === 4 && value.selection.every(item => item.id.startsWith('a')), 'all export selections confined');
    if (value.messages) assert(value.messages.every(item => item.event.packet.topic === 'site/device/state/osd'), 'raw export confined');
    if (value.report) assert(value.report.topicGroup === 'site/device/state' && value.report.groups.every(group => group.topic === 'site/device/state/osd'), 'report confined');
  }
  await page.screenshot({ path: '.playwright-cli/analysis-topic-group.png' });
  await page.locator('#analysisChangesTable').getByRole('button', { name: '查看对比' }).first().click();
  const context = await page.locator('#compareContextText').textContent();
  assert(context.includes('a2') && context.includes('a3'), 'newest row opens its chronological previous comparison: ' + await page.locator('#compareObjects').innerText());
  const options = await page.locator('#compareASelect option').evaluateAll(nodes => nodes.map(node => node.value).filter(Boolean));
  assert(options.length === 4 && options.every(id => id.startsWith('a')), 'A/B choices contain only current group');
  await page.locator('#analysisRawTab').click();
  assert((await page.locator('#analysisRawContent').innerText()).includes('site/device/state'), 'raw preview populated before switch');
  await page.locator('#analysisTopicGroup').selectOption('other/device/state/osd');
  assert(await page.locator('[data-analysis-id]').count() === 0 && await page.locator('#analysisExportCombined').isDisabled() && await page.locator('#analysisExportRaw').isDisabled(), 'scope switch clears selection and disables old exports');
  assert((await page.locator('#analysisRawContent').textContent()) === '' && (await page.locator('#compareContextText').textContent()) === '', 'scope switch removes old raw and comparison context');
  await page.locator('#analysisLatestCount').fill('10'); await page.locator('#analysisSelectLatest').click();
  await page.waitForFunction(() => !document.querySelector('#analysisExportCombined').disabled);
  ids = await page.locator('[data-analysis-id]').evaluateAll(nodes => nodes.map(node => node.dataset.analysisId));
  assert(JSON.stringify(ids) === JSON.stringify(['b2', 'b1']), 'new analysis contains only selected group');
  await page.locator('#mqttModuleButton').click();
  await page.locator('#addFilteredToAnalysis').click();
  ids = await page.locator('[data-analysis-id]').evaluateAll(nodes => nodes.map(node => node.dataset.analysisId));
  assert(ids.length === 2 && ids.every(id => id.startsWith('b')), 'mixed filtered additions constrained to current scope');
  await page.locator('#mqttModuleButton').click();
  await page.locator('[data-render-key="a3"]').click(); await page.locator('#quickAddAnalysis').click();
  assert(await page.locator('#analysisTopicGroup').inputValue() === 'site/device/state/osd' && await page.locator('[data-analysis-id]').count() === 1, 'single message entry switches scope and clears old selection');
  await page.evaluate(() => mqttHarness.emit(Array.from({ length: 200 }, (_, i) => scopeEvent('job-' + i, 'site/device/state/osd', i))));
  await page.locator('#analysisLatestCount').fill('200');
  await page.evaluate(() => {
    document.querySelector('#analysisFetchLatest').click();
    const select = document.querySelector('#analysisTopicGroup'); select.value = 'other/device/state/osd'; select.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(300);
  assert(await page.locator('#analysisExportChanges').isDisabled() && await page.locator('#analysisChangesTable tbody tr').count() === 0, 'scope switch cancels unfinished old job');
  await page.locator('#analysisTopicGroup').selectOption('site/device/state/osd');
  await page.locator('#analysisLatestCount').fill('10'); await page.locator('#analysisSelectLatest').click();
  await page.waitForFunction(() => !document.querySelector('#analysisExportCombined').disabled);
  const retainedSummary = await page.locator('#analysisResultSummary').textContent();
  const retainedCount = (await page.locator('#analysisCacheStatus').innerText()).match(/独立缓存 (\d+)/)[1];
  await page.evaluate(() => mqttHarness.emit(Array.from({ length: 5001 }, (_, i) => scopeEvent('evict-' + i, 'other/device/state/osd', i))));
  await page.waitForFunction(() => document.querySelector('#analysisCacheStatus').textContent.includes('已冻结'));
  assert((await page.locator('#analysisCacheStatus').innerText()).includes('独立缓存 ' + retainedCount + ' /'), 'frozen cache does not receive subsequent burst');
  assert(await page.locator('#analysisTopicGroup').inputValue() === 'site/device/state/osd' && !(await page.locator('#analysisSelectLatest').isDisabled()), 'selected Topic survives cache saturation');
  assert(await page.locator('#analysisResultSummary').textContent() === retainedSummary && !(await page.locator('#analysisExportCombined').isDisabled()), 'saturation preserves results and exports');
  assert((await page.locator('#analysisFreezeStatus').innerText()).includes('不再自动接收分析消息'), 'frozen status explains manual refresh');
  assert(errors.length === 0, errors.join('; '));
  return { passed: ['mandatory single group', 'sidebar entry', 'scoped latest N', 'exact Topic and device isolation', 'group shortage', 'three scoped exports', 'scope switching clears state', 'bulk additions scoped', 'single message scope switch', 'in-flight cancellation', 'cache saturation preserves Topic and report'] };
}
