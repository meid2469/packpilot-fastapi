const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engineModule = {exports: {}};
new Function('module', fs.readFileSync(require.resolve('../static/v2/engine.js'), 'utf8'))(engineModule);
const P = engineModule.exports;
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

test('PA/PE历史尺寸：6000m双出、7%损耗得到62000整袋，内膜增加5mm', () => {
  const r = P.calculate(P.presets.paPe());
  assert.equal(r.ok, true);
  close(r.rawQuantity, 66666.66666666667);
  assert.equal(r.theoreticalQuantity, 66666);
  assert.equal(r.qualifiedQuantity, 62000);
  assert.equal(r.billableQuantity, 62000);
  assert.deepEqual(r.layers.map(l => l.widthMm), [460, 465]);
  close(r.layers[0].theoreticalKg, 47.61);
  close(r.layers[1].theoreticalKg, 194.6025);
  close(r.layers[0].actualKg, 48.5622);
  close(r.layers[1].actualKg, 198.49455);
  close(r.materialCost, 3038.559345);
  close(r.laminationCost, 303.6);
  close(r.baggingCost, 620);
  assert.equal(r.packagingCount, 9);
  close(r.packagingCost, 40.86);
  close(r.totalCost, 4003.019345);
  close(r.unitCost, 0.0645648281451613);
});

test('历史3969.83采用不同实投料与旧包装价；按新固定包装价不强凑原单', () => {
  const c = P.presets.paPe();
  c.layers[0].actualKg = 48;
  c.layers[1].actualKg = 197;
  const r = P.calculate(c);
  close(r.materialCost, 3012.30);
  close(r.totalCost, 3976.76);
  close(r.totalCost - r.packagingCost + 33.93, 3969.83);
  assert.equal(r.layers.every(l => l.overridden), true);
  assert.ok(r.historicalComparison.note.includes('不同实投料'));
});

test('细算胶量按450mm皮轴计，综合面积保持460mm，两种模式二选一', () => {
  const c = P.presets.paPe();
  c.lamination.mode = 'detail';
  c.lamination.rate = 999;
  const r = P.calculate(c);
  assert.equal(r.lamination.rollerWidthMm, 450);
  assert.equal(r.lamination.fullAreaM2, 2760);
  assert.equal(r.lamination.glueAreaM2, 2700);
  close(r.lamination.glueKgPerPass, 4.05);
  close(r.lamination.glueCostPerPass, 83.025);
  close(r.laminationCost, 283.025);
  close(r.totalCost, 3982.444345);
  assert.equal(r.lamination.includedGlueCost, r.lamination.glueCostPerPass);
  c.lamination.mode = 'area'; c.lamination.rate = 0.11;
  const area = P.calculate(c);
  close(area.laminationCost, 303.6);
  assert.equal(area.lamination.includedGlueCost, null);
});

test('茶叶148×105、510mm三出：完整展开宽不再乘2；PE内膜515mm', () => {
  const c = P.presets.tea();
  const r = P.calculate(c);
  assert.equal(r.ok, true);
  close(r.rawQuantity, 171428.57142857142);
  assert.equal(r.theoreticalQuantity, 171428);
  assert.equal(r.qualifiedQuantity, 159428);
  assert.equal(r.billableQuantity, 159428);
  assert.deepEqual(r.layers.map(l => l.widthMm), [510, 510, 515]);
  close(r.layers[0].theoreticalKg, 51.408);
  close(r.layers[1].theoreticalKg, 51.408);
  close(r.layers[2].theoreticalKg, 175.2957);
  close(r.totalTheoreticalKg, 278.1117);
  assert.equal(r.lamination.passes, 2);
  close(r.laminationCost, 673.2);
  assert.equal(r.packagingCount, 16);
  c.lamination.mode = 'detail';
  const detailed = P.calculate(c);
  assert.equal(detailed.lamination.rollerWidthMm, 500);
  close(detailed.lamination.glueAreaM2, 3000);
  close(detailed.laminationCost, 584.5);
});

test('不可售超产只缩小结算分母，不转移原膜复合制袋成本，包装按交付数取整', () => {
  const c = P.presets.paPe();
  const full = P.calculate(c);
  c.orderQuantity = 50000;
  const short = P.calculate(c);
  assert.equal(short.billableQuantity, 50000);
  assert.equal(short.unsoldQuantity, 12000);
  assert.equal(short.materialCost, full.materialCost);
  assert.equal(short.laminationCost, full.laminationCost);
  assert.equal(short.baggingCost, full.baggingCost);
  assert.equal(short.packagingCount, 7);
  assert.ok(short.unitCost > full.unitCost);
  close(short.unitCost, short.totalCost / 50000);
  assert.ok(short.warnings.some(w => w.includes('不可结算')));
});

test('交付上限超过一轴合格数时只结算实际可得数并提示不足', () => {
  const c = P.presets.paPe(); c.orderQuantity = 100000;
  const r = P.calculate(c);
  assert.equal(r.billableQuantity, 62000);
  assert.ok(r.warnings.some(w => w.includes('不能满足')));
});

test('中封展开总占幅超过膜宽时明确提示排版可能无法生产', () => {
  const c = P.presets.tea(); c.widthMm = 180;
  const r = P.calculate(c);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some(w => w.includes('展开宽×排版出数超过复合膜宽')));
});

test('PA比重1.15及1.16显式标为假设，不声称是所有PA的保证范围', () => {
  const c = P.presets.paPe(); c.layers[0].density = 1.16;
  const r = P.calculate(c);
  assert.ok(r.layers[0].note.includes('并非所有PA/BOPA的保证范围'));
  assert.ok(r.warnings.some(w => w.includes('输入假设1.16') && w.includes('不是通用保证范围')));
});

test('纸箱辅料固定、口袋合格证可选，包装以每件容量向上取整', () => {
  const c = P.presets.paPe();
  c.packaging.type = 'pocket'; c.packaging.capacity = 10000; c.packaging.certificate = false;
  const r = P.calculate(c);
  assert.equal(r.packagingCount, 7);
  close(r.packagingCost, 10.92);
  c.packaging.certificate = true;
  close(P.calculate(c).packagingCost, 11.62);
  c.orderQuantity = 60000;
  assert.equal(P.calculate(c).packagingCount, 6);
});

test('制袋计费基数可切换合格/理论/结算，最终成本没有额外1.07', () => {
  const c = P.presets.paPe(); c.orderQuantity = 60000;
  c.bagging.basis = 'theoretical';
  close(P.calculate(c).baggingCost, 666.66);
  c.bagging.basis = 'billable';
  const r = P.calculate(c);
  close(r.baggingCost, 600);
  close(r.totalCost, r.materialCost + r.laminationCost + r.baggingCost + r.packagingCost);
});

test('模板重叠明确告警，手工费率覆盖模板，5轴边界待核实', () => {
  const c = P.presets.paPe(); c.lanes = 3; c.heightMm = 200; c.cutLengthMm = 200;
  const fee = P.bagFeeFor(c);
  close(fee.rate, 0.01);
  assert.ok(fee.warnings.some(w => w.includes('重叠')));
  c.bagging.rate = 0.017;
  close(P.calculate(c).bagging.rate, 0.017);
  c.rollCount = 5;
  assert.ok(P.calculate(c).warnings.some(w => w.includes('恰好5轴')));
  c.rollCount = 6;
  close(P.calculate(c).lamination.rate, 0.10);
  assert.equal(P.calculate(c).rawQuantity, 90000);
});

test('干复胶水类型模板和人工复合道数生效，计价批量不增加6000m核算长度', () => {
  const c = P.presets.paPe();
  c.lamination.process = 'dry-boil';
  close(P.calculate(c).laminationCost, 690);
  c.lamination.mode = 'detail'; c.lamination.passes = 2;
  const r = P.calculate(c);
  close(r.laminationCost, 566.05);
  assert.ok(r.warnings.some(w => w.includes('200元')));
});

test('未知模板必须手工费率；自立和拉链加价明确计入并告警', () => {
  const c = P.presets.paPe(); c.bagType = 'custom';
  assert.equal(P.calculate(c).ok, false);
  c.bagging.rate = 0.02; c.bagging.standup = true; c.bagging.zipper = true;
  const r = P.calculate(c);
  assert.equal(r.ok, true);
  close(r.bagging.rate, 0.04);
  assert.ok(r.warnings.some(w => w.includes('叠加')));
});

test('非法及缺失数值不返回误导报价，至少2层且无字符串隐式强转', () => {
  const variants = [
    c => c.cutLengthMm = 0,
    c => c.lossPct = 100,
    c => c.lanes = 1.5,
    c => c.filmWidthMm = 10,
    c => c.layers = [c.layers[0]],
    c => c.layers[0].actualKg = -1,
    c => c.layers[0].pricePerKg = NaN,
    c => c.layers[0].density = '1.15',
    c => c.packaging.capacity = 0,
    c => c.orderQuantity = 0,
    c => c.lamination.passes = 0,
    c => delete c.layers[1].thicknessUm,
    c => c.lamination.mode = 'both'
  ];
  for (const mutate of variants) {
    const c = P.presets.paPe(); mutate(c);
    const r = P.calculate(c);
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
    assert.equal(r.unitCost, undefined);
  }
  assert.equal(P.calculate(null).ok, false);
});

test('手动kg在参数更改后保留；清空恢复理论×1.02；低于理论时告警', () => {
  const c = P.presets.paPe(); c.layers[0].actualKg = 40; c.filmWidthMm = 500;
  const r = P.calculate(c);
  assert.equal(r.layers[0].actualKg, 40);
  assert.ok(r.warnings.some(w => w.includes('低于6000m理论重量')));
  c.layers[0].actualKg = '';
  close(P.calculate(c).layers[0].actualKg, 52.785);
});

test('默认对象不共享状态；浏览器UMD加载与Node一致', () => {
  const a = P.presets.paPe(); const b = P.presets.paPe(); a.layers[0].pricePerKg = 999;
  assert.equal(b.layers[0].pricePerKg, 17.2);
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../static/v2/engine.js'), 'utf8'), context);
  const r = context.PackPilot.calculate(context.PackPilot.defaultConfig());
  close(r.totalCost, 4003.019345);
  assert.equal(r.ok, true);
});

test('PA/PE110×180自动分层成品克重含胶为3.5046g，投料和损耗不改变成品克重', () => {
  const c = P.presets.paPe();
  const r = P.calculate(c);
  assert.equal(r.weight.available, true);
  assert.equal(r.weight.manualArea, false);
  close(r.weight.areaM2, 0.0396);
  close(r.weight.layers[0].grams, 0.6831);
  close(r.weight.layers[1].grams, 2.7621);
  close(r.weight.filmGrams, 3.4452);
  close(r.weight.glueGrams, 0.0594);
  close(r.weight.totalGrams, 3.5046);
  c.layers[0].actualKg = 80;
  c.lossPct = 20;
  c.filmWidthMm = 500;
  const changed = P.calculate(c);
  close(changed.weight.totalGrams, r.weight.totalGrams);
  assert.notEqual(changed.totalCost, r.totalCost);
});

test('中封展开宽只算一次；三层成品含胶按两道，复杂袋型待确认面积时仍可核价', () => {
  const tea = P.calculate(P.presets.tea());
  close(tea.weight.areaM2, 0.01554);
  close(tea.weight.filmGrams, 0.01554 * (12 * 1.4 + 12 * 1.4 + 61 * 0.93));
  close(tea.weight.glueGrams, 0.01554 * 1.5 * 2);
  const c = P.presets.paPe();
  c.bagging.standup = true;
  let r = P.calculate(c);
  assert.equal(r.ok, true);
  assert.equal(r.weight.available, false);
  assert.equal(r.weight.totalGrams, null);
  assert.ok(r.warnings.some(w => w.includes('填写单袋完整展开面积')));
  c.weight.areaM2 = 0.05;
  r = P.calculate(c);
  assert.equal(r.weight.available, true);
  assert.equal(r.weight.manualArea, true);
  close(r.weight.totalGrams, 0.05 * (15 * 1.15 + 75 * 0.93 + 1.5));
  c.bagType = 'custom'; c.bagging.rate = 0.02; c.bagging.standup = false; c.weight.areaM2 = null;
  r = P.calculate(c);
  assert.equal(r.ok, true);
  assert.equal(r.weight.available, false);
  assert.equal(r.weight.layers[0].grams, null);
});

test('无印刷默认价格不变，平米印刷1380元只加入一次，色数不重复乘费用', () => {
  const c = P.presets.paPe();
  const unprinted = P.calculate(c);
  assert.equal(unprinted.printingCost, 0);
  close(unprinted.totalCost, 4003.019345);
  c.printing.mode = 'area'; c.printing.colors = 8;
  const printed = P.calculate(c);
  close(printed.printing.areaM2, 2760);
  close(printed.printing.rate, 0.5);
  close(printed.printingCost, 1380);
  close(printed.totalCost, unprinted.totalCost + 1380);
  close(printed.weight.totalGrams, unprinted.weight.totalGrams);
  c.printing.rate = 0.6;
  close(P.calculate(c).printingCost, 1656);
  c.printing.rate = 0;
  close(P.calculate(c).printingCost, 0);
  c.printing.mode = 'none'; c.printing.rate = 99;
  close(P.calculate(c).totalCost, unprinted.totalCost);
});

test('工厂印刷阶梯按色数及批次选每轴费，6色5轴与7色3轴边界明确', () => {
  for (const [colors, rolls, expected] of [[1, 1, 300], [6, 4, 300], [6, 5, 200], [7, 3, 500], [7, 4, 300], [10, 8, 300]]) {
    const c = P.presets.paPe();
    c.printing.mode = 'tier'; c.printing.colors = colors; c.rollCount = rolls;
    const r = P.calculate(c);
    assert.equal(r.ok, true);
    close(r.printing.ratePerRoll, expected);
    close(r.printingCost, expected);
    // Total cost may select a different lamination tier; assert components,
    // not an unrelated baseline for a different batch size.
    close(r.totalCost, r.materialCost + expected + r.laminationCost + r.baggingCost + r.packagingCost);
    assert.ok(r.warnings.some(w => w.includes('2020年模板')));
  }
  const c = P.presets.paPe(); c.printing.mode = 'tier'; c.printing.tierRatePerRoll = 175;
  close(P.calculate(c).printingCost, 175);
  c.printing.tierRatePerRoll = 0;
  close(P.calculate(c).printingCost, 0);
});

test('旧规格缺少印刷克重设置时默认无印刷加载，不修改源对象或丢弃扩展输入', () => {
  const old = P.presets.paPe(); delete old.printing; delete old.weight;
  old.futureField = {extra: 0};
  const normalized = P.normalizeConfig(old);
  assert.equal(old.printing, undefined);
  assert.equal(old.weight, undefined);
  assert.deepEqual(normalized.printing, {mode: 'none', rate: null, colors: 1, tierRatePerRoll: null});
  assert.deepEqual(normalized.weight, {areaM2: null});
  assert.deepEqual(normalized.futureField, {extra: 0});
  const r = P.calculate(old);
  assert.equal(r.ok, true);
  close(r.totalCost, 4003.019345);
  close(r.weight.totalGrams, 3.5046);
  assert.deepEqual(P.validate(old), []);
  const other = P.normalizeConfig(old); normalized.printing.colors = 9;
  assert.equal(other.printing.colors, 1);
});

test('印刷和克重非法配置均明确拒绝，不将NaN或字符串转成默认值', () => {
  for (const mutate of [
    c => c.printing.mode = 'both',
    c => c.printing.colors = 0,
    c => c.printing.colors = 1.5,
    c => c.printing.rate = -1,
    c => c.printing.tierRatePerRoll = Infinity,
    c => c.printing.rate = '0.5',
    c => c.weight.areaM2 = 0,
    c => c.weight.areaM2 = NaN,
    c => c.weight.areaM2 = -1,
    c => c.weight = null,
    c => c.printing = [],
  ]) {
    const c = P.presets.paPe(); mutate(c);
    const r = P.calculate(c);
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
    assert.equal(r.unitCost, undefined);
  }
});
