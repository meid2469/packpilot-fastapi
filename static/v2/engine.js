(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PackPilot = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '2.0.1';
  const CONSTANTS = Object.freeze({ rollLengthM: 6000, extraInputRatio: 0.02, innerExtraWidthMm: 5, rollerReductionMm: 10, glueGPerM2: 1.5, gluePricePerKg: 20.5, laborPerPass: 200, cartonPrice: 4.10, linerPrice: 0.34, certificatePrice: 0.10, pocketPrice: 1.56 });
  const MATERIALS = [
    { id: 'PET', name: 'PET', density: 1.40, note: 'PET薄膜比重默认1.40；以实际供应商规格为准。' },
    { id: 'PA', name: 'PA / BOPA', density: 1.15, note: 'PA/BOPA默认1.15为估算假设，1.16仅为可选估算值，并非所有PA/BOPA的保证范围；实际比重以供应商牌号资料为准。' },
    { id: 'VMPET', name: 'VMPET', density: 1.40, note: '按PET基膜比重1.40估算，忽略镀铝层增重；以供应商面密度为准。' },
    { id: 'PE', name: 'PE（工厂示例）', density: 0.93, note: '0.93仅沿用历史工厂PE示例，配方及牌号待确认，不是通用PE物性。' },
    { id: 'LDPE', name: 'LDPE（HP4025ZN示例）', density: 0.923, note: 'SABIC HP4025ZN膜级树脂示例0.923；需按实际厂家牌号及配方校正。' },
    { id: 'LLDPE', name: 'LLDPE（Shell 18F5M示例）', density: 0.918, note: 'Shell Polymers 18F5M流延膜树脂示例0.918；需按实际厂家牌号及配方校正。' },
    { id: 'HDPE', name: 'HDPE（F00952示例）', density: 0.952, note: '高密度聚乙烯F00952示例0.952；不能将低压PE统一写成0.90。' },
    { id: 'RCPP', name: 'RCPP', density: 0.91, note: '工厂约定暂取0.91；按厂家CPP/RCPP实际资料校正。' },
    { id: 'CUSTOM', name: '自定义材料', density: 1.00, note: '占位值；必须录入供应商实际比重。' }
  ];
  const BAG_TEMPLATES = [
    { id: 'three-3-300', bagType: 'three-side', lanes: 3, maxMm: 300, rate: 0.010, note: '三联≤30cm；与≤35cm文字范围重叠，暂取较小上限档，待核实。' },
    { id: 'three-3-350', bagType: 'three-side', lanes: 3, maxMm: 350, rate: 0.015, note: '三联≤35cm；按更小上限优先匹配，待核实。' },
    { id: 'three-2-250', bagType: 'three-side', lanes: 2, maxMm: 250, rate: 0.010, note: '二联≤25cm。' },
    { id: 'three-1-250', bagType: 'three-side', lanes: 1, maxMm: 250, rate: 0.015, note: '一联≤25cm。' },
    { id: 'three-1-350', bagType: 'three-side', lanes: 1, maxMm: 350, rate: 0.020, note: '一联≤35cm；按更小上限优先。' },
    { id: 'three-1-450', bagType: 'three-side', lanes: 1, maxMm: 450, rate: 0.030, note: '一联≤45cm；按更小上限优先。' },
    { id: 'three-1-600', bagType: 'three-side', lanes: 1, maxMm: 600, rate: 0.040, note: '一联≤60cm；按更小上限优先。' },
    { id: 'back-200', bagType: 'back-seal', maxMm: 200, rate: 0.015, note: '背封≤20cm。' },
    { id: 'back-over200', bagType: 'back-seal', minExclusiveMm: 200, maxMm: 300, rate: 0.020, note: '背封>20cm；超过30cm按三边封需确认。' },
    { id: 'four-200', bagType: 'four-lane', lanes: 4, maxMm: 200, rate: 0.008, note: '四联≤20cm；袋型适用范围待核实。' }
  ];
  const LAMINATION_TEMPLATES = [
    { id: 'solventless', name: '无溶剂', rate: 0.11, note: '少于5轴0.11元/㎡，多于5轴0.10元/㎡；恰好5轴边界待核实。' },
    { id: 'dry-normal', name: '干复·普通胶', rate: 0.22 },
    { id: 'dry-boil', name: '干复·水煮胶', rate: 0.25 },
    { id: 'dry-retort', name: '干复·蒸煮胶', rate: 0.30 },
    { id: 'dry-yuli', name: '干复·玉立胶', rate: 0.30 }
  ];
  const clone = value => JSON.parse(JSON.stringify(value));
  const blank = value => value === null || value === undefined || value === '';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const floorQuantity = value => Math.floor(value + 1e-8);
  // Fill only fields introduced after the original V2. Existing saved quotes
  // keep every original input, including zero overrides and inactive fields.
  // Do not JSON-clone here: NaN/Infinity must reach validation unchanged.
  function normalizeConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
    const c = {...config};
    const printingDefaults = {mode: 'none', rate: null, colors: 1, tierRatePerRoll: null};
    const weightDefaults = {areaM2: null};
    if (c.printing === undefined) c.printing = {...printingDefaults};
    else if (c.printing && typeof c.printing === 'object' && !Array.isArray(c.printing)) c.printing = {...printingDefaults, ...c.printing};
    if (c.weight === undefined) c.weight = {...weightDefaults};
    else if (c.weight && typeof c.weight === 'object' && !Array.isArray(c.weight)) c.weight = {...weightDefaults, ...c.weight};
    return c;
  }
  function defaultConfig() {
    return {
      name: 'PA / PE 无印刷复合袋', bagType: 'three-side', widthMm: 110, heightMm: 180,
      cutLengthMm: 180, lanes: 2, filmWidthMm: 460, lossPct: 7, orderQuantity: 62000, rollCount: 1,
      layers: [
        { material: 'PA', thicknessUm: 15, density: 1.15, pricePerKg: 17.2, actualKg: null },
        { material: 'PE', thicknessUm: 75, density: 0.93, pricePerKg: 11.1, actualKg: null }
      ],
      printing: { mode: 'none', rate: null, colors: 1, tierRatePerRoll: null },
      weight: { areaM2: null },
      lamination: { mode: 'area', process: 'solventless', rate: null, passes: null },
      bagging: { rate: null, basis: 'qualified', standup: false, zipper: false },
      packaging: { type: 'carton', capacity: 7400, certificate: true },
      notes: '历史PA/PE示例原膜单价；请更新为当前采购单价。'
    };
  }
  const presets = {
    paPe: defaultConfig,
    tea: function () {
      const c = defaultConfig();
      Object.assign(c, { name: '茶叶中封袋 · PET / VMPET / PE', bagType: 'back-seal', widthMm: 148, heightMm: 105, cutLengthMm: 105, lanes: 3, filmWidthMm: 510, orderQuantity: null });
      c.layers = [
        { material: 'PET', thicknessUm: 12, density: 1.4, pricePerKg: 10, actualKg: null },
        { material: 'VMPET', thicknessUm: 12, density: 1.4, pricePerKg: 12, actualKg: null },
        { material: 'PE', thicknessUm: 61, density: 0.93, pricePerKg: 11.1, actualKg: null }
      ];
      c.packaging.capacity = 10000;
      c.notes = '茶叶袋148mm按完整展开宽度（含背封搭接）；510mm三出排版、PE61μm及全部材料价格为待核实演示参数。';
      return c;
    }
  };
  function bagFeeFor(config) {
    const warnings = [];
    const b = config.bagging || {};
    const length = config.heightMm;
    const candidates = BAG_TEMPLATES.filter(t => t.bagType === config.bagType && (!t.lanes || t.lanes === config.lanes) && length <= t.maxMm && (!t.minExclusiveMm || length > t.minExclusiveMm)).sort((a, b) => a.maxMm - b.maxMm);
    let selected = candidates[0];
    if (config.bagType === 'back-seal' && length > 300) {
      selected = BAG_TEMPLATES.filter(t => t.bagType === 'three-side' && t.lanes === config.lanes && length <= t.maxMm).sort((a, b) => a.maxMm - b.maxMm)[0];
      warnings.push('背封长度超过30cm：暂参考同联数三边封档位，工厂适用口径待核实，请人工确认制袋费。');
    }
    if (candidates.length > 1) warnings.push('制袋阶梯原文范围重叠：暂优先匹配最小长度上限；档位待工厂核实，可手工覆盖。');
    if (config.bagType === 'four-lane') warnings.push('四联0.008元/个的袋型适用范围待核实。');
    if (!selected && blank(b.rate)) warnings.push('没有覆盖此袋型/联数/长度的制袋模板，请输入确认后的制袋单价。');
    const baseRate = !blank(b.rate) ? b.rate : selected ? selected.rate : null;
    const addition = (b.standup ? 0.01 : 0) + (b.zipper ? 0.01 : 0);
    if (addition) warnings.push('自立/拉链各加0.01元/个暂按模板原文叠加，袋型适用及是否可叠加待核实；手工价为基础单价。');
    return { rate: baseRate === null ? null : baseRate + addition, baseRate, addition, template: selected || null, manual: !blank(b.rate), warnings };
  }
  function laminationRateFor(config) {
    const l = config.lamination || {};
    const selected = LAMINATION_TEMPLATES.find(t => t.id === l.process);
    const warnings = [];
    let rate = selected ? selected.rate : null;
    if (l.process === 'solventless') {
      if (config.rollCount > 5) rate = 0.10;
      if (config.rollCount === 5) warnings.push('无溶剂模板“5轴以下/以上”在恰好5轴处重叠，暂取0.11元/㎡，请核实或手工覆盖。');
    }
    if (!blank(l.rate)) rate = l.rate;
    return { rate, template: selected || null, manual: !blank(l.rate), warnings };
  }
  function validate(config) {
    const errors = [];
    const c = normalizeConfig(config);
    if (!c || typeof c !== 'object' || Array.isArray(c)) return ['报价数据必须为对象。'];
    function number(value, label, min, max, integer) {
      if (!finite(value) || value < min || (max !== undefined && value > max) || (integer && !Number.isInteger(value))) errors.push(label + '必须为' + (integer ? '整数' : '有效数字') + '，范围' + min + (max !== undefined ? '～' + max : '以上') + '。');
    }
    number(c.widthMm, '产品宽度(mm)', 0.001);
    number(c.heightMm, '产品长度(mm)', 0.001);
    number(c.cutLengthMm, '走膜切长(mm)', 0.001);
    number(c.lanes, '排版出数', 1, 1000, true);
    number(c.filmWidthMm, '复合膜宽(mm)', 10.001);
    number(c.lossPct, '制袋损耗率(%)', 0, 99.999);
    number(c.rollCount, '模板计价批量(轴)', 1, undefined, true);
    if (!blank(c.orderQuantity)) number(c.orderQuantity, '订单可结算数量', 1, Number.MAX_SAFE_INTEGER, true);
    if (!['three-side', 'back-seal', 'four-lane', 'custom'].includes(c.bagType)) errors.push('请选择有效袋型。');
    if (!Array.isArray(c.layers) || c.layers.length < 2) errors.push('至少需要2层原膜；最后一层固定为内膜。');
    else c.layers.forEach((layer, index) => {
      if (!layer || typeof layer !== 'object') { errors.push('第' + (index + 1) + '层数据无效。'); return; }
      const label = '第' + (index + 1) + '层';
      if (typeof layer.material !== 'string' || !layer.material.trim()) errors.push(label + '必须填写材质。');
      number(layer.thicknessUm, label + '厚度(μm)', 0.001);
      number(layer.density, label + '比重(g/cm³)', 0.001);
      number(layer.pricePerKg, label + '价格(元/kg)', 0);
      if (!blank(layer.actualKg)) number(layer.actualKg, label + '实际投料(kg)', 0.000001);
    });
    if (!c.weight || typeof c.weight !== 'object' || Array.isArray(c.weight)) errors.push('成品克重设置必须为对象。');
    else if (!blank(c.weight.areaM2)) number(c.weight.areaM2, '单袋完整展开面积(㎡)', 0.000000001);
    const printing = c.printing;
    if (!printing || typeof printing !== 'object' || Array.isArray(printing)) errors.push('印刷设置必须为对象。');
    else {
      if (!['none', 'area', 'tier'].includes(printing.mode)) errors.push('印刷模式必须为无印刷、综合平米费或工厂阶梯模板。');
      number(printing.colors, '印刷色数', 1, 1000, true);
      if (!blank(printing.rate)) number(printing.rate, '印刷综合费率(元/㎡)', 0);
      if (!blank(printing.tierRatePerRoll)) number(printing.tierRatePerRoll, '印刷阶梯人工覆盖(元/轴)', 0);
    }
    const l = c.lamination;
    if (!l || typeof l !== 'object') errors.push('缺少复合费设置。');
    else {
      if (!['area', 'detail'].includes(l.mode)) errors.push('复合费用模式必须选择综合平方米或胶水人工细算。');
      if (!LAMINATION_TEMPLATES.some(t => t.id === l.process)) errors.push('请选择有效复合工艺。');
      if (!blank(l.passes)) number(l.passes, '复合道数', 1, 1000, true);
      if (l.mode === 'area' && !blank(l.rate)) number(l.rate, '综合复合费率(元/㎡)', 0);
    }
    const b = c.bagging;
    if (!b || typeof b !== 'object') errors.push('缺少制袋费设置。');
    else {
      if (!['qualified', 'theoretical', 'billable'].includes(b.basis)) errors.push('制袋费计费基数无效。');
      if (!blank(b.rate)) number(b.rate, '制袋基础单价(元/个)', 0);
      if (bagFeeFor(c).rate === null) errors.push('当前制袋模板不适用，请手工输入制袋基础单价。');
    }
    const p = c.packaging;
    if (!p || typeof p !== 'object') errors.push('缺少包装设置。');
    else {
      if (!['carton', 'pocket'].includes(p.type)) errors.push('包装方式必须为纸箱或包装口袋。');
      number(p.capacity, '每件装袋量', 1, Number.MAX_SAFE_INTEGER, true);
      if (typeof p.certificate !== 'boolean') errors.push('合格证选项必须为布尔值。');
    }
    return errors;
  }
  function calculate(config) {
    const errors = validate(config);
    if (errors.length) return { ok: false, errors, warnings: [] };
    const c = clone(normalizeConfig(config));
    const bagFee = bagFeeFor(c);
    const lamFee = laminationRateFor(c);
    const warnings = [...bagFee.warnings, ...(c.lamination.mode === 'area' ? lamFee.warnings : [])];
    if (c.bagType === 'back-seal' && c.widthMm * c.lanes > c.filmWidthMm) warnings.push('中封袋展开宽×排版出数超过复合膜宽，当前横向排版可能无法生产，请车间核实展开宽、出数及膜宽。');
    const rawQuantity = CONSTANTS.rollLengthM * 1000 / c.cutLengthMm * c.lanes;
    const theoreticalQuantity = floorQuantity(rawQuantity);
    const qualifiedQuantity = floorQuantity(rawQuantity * (1 - c.lossPct / 100));
    const billableQuantity = blank(c.orderQuantity) ? qualifiedQuantity : Math.min(qualifiedQuantity, c.orderQuantity);
    if (qualifiedQuantity < 1 || billableQuantity < 1) return { ok: false, errors: ['预计可结算数量不足1个，请调整切长、出数或损耗率。'], warnings };
    if (!Number.isSafeInteger(theoreticalQuantity)) return { ok: false, errors: ['理论数量超过安全计算范围，请核对切长与出数。'], warnings };
    if (!blank(c.orderQuantity) && c.orderQuantity > qualifiedQuantity) warnings.push('订单可结算数量超过预计合格数，当前只按预计合格数结算；一轴不能满足所填数量。');
    const unsoldQuantity = qualifiedQuantity - billableQuantity;
    if (unsoldQuantity > 0) warnings.push('有' + unsoldQuantity + '个预计合格袋不可结算：全部生产成本由本单' + billableQuantity + '个可结算袋承担。');
    const layers = c.layers.map((layer, index) => {
      const position = index === c.layers.length - 1 ? 'inner' : index === 0 ? 'outer' : 'middle';
      const widthMm = c.filmWidthMm + (position === 'inner' ? CONSTANTS.innerExtraWidthMm : 0);
      const thicknessMm = layer.thicknessUm / 1000;
      const theoreticalKg = widthMm * CONSTANTS.rollLengthM * thicknessMm * layer.density / 1000;
      const suggestedKg = theoreticalKg * (1 + CONSTANTS.extraInputRatio);
      const overridden = !blank(layer.actualKg);
      const actualKg = overridden ? layer.actualKg : suggestedKg;
      const cost = actualKg * layer.pricePerKg;
      const material = MATERIALS.find(m => m.id === layer.material);
      if (layer.material === 'PA' || /BOPA/i.test(layer.material)) warnings.push('第' + (index + 1) + '层PA/BOPA比重为输入假设' + layer.density + '；默认1.15及可选1.16不是通用保证范围，实际以供应商牌号资料为准。');
      if (layer.material === 'PE') warnings.push('第' + (index + 1) + '层PE比重' + layer.density + '为工厂示例/手工值；请确认PE类型与厂家牌号。');
      if (layer.material === 'CUSTOM') warnings.push('第' + (index + 1) + '层自定义材料：比重需由供应商资料确认。');
      if (actualKg < theoreticalKg) warnings.push('第' + (index + 1) + '层人工投料低于6000m理论重量，可能无法完成本轴生产。');
      return { ...layer, index, position, widthMm, thicknessMm, theoreticalKg, suggestedKg, actualKg, overridden, cost, note: material ? material.note : '自定义材质，请核实供应商比重。' };
    });
    const materialCost = layers.reduce((sum, layer) => sum + layer.cost, 0);
    const totalTheoreticalKg = layers.reduce((sum, layer) => sum + layer.theoreticalKg, 0);
    const totalActualKg = layers.reduce((sum, layer) => sum + layer.actualKg, 0);
    const passes = blank(c.lamination.passes) ? layers.length - 1 : c.lamination.passes;
    if (layers.length > 2 || passes !== layers.length - 1) warnings.push('多层复合暂按' + passes + '道计费，每道均走6000m、细算人工水电200元；实际工艺道数和收费口径待工厂核实。');
    const fullAreaM2 = c.filmWidthMm / 1000 * CONSTANTS.rollLengthM;
    // The photographed factory template prices one 6000m axis. Batch rollCount
    // selects its tier; it never multiplies this one-axis quotation.
    const printingRate = c.printing.mode === 'area' ? (blank(c.printing.rate) ? 0.50 : c.printing.rate) : null;
    const templatePrintRate = c.printing.colors <= 6 ? (c.rollCount >= 5 ? 200 : 300) : (c.rollCount > 3 ? 300 : 500);
    const printingRatePerRoll = c.printing.mode === 'tier' ? (blank(c.printing.tierRatePerRoll) ? templatePrintRate : c.printing.tierRatePerRoll) : null;
    const printingCost = c.printing.mode === 'none' ? 0 : c.printing.mode === 'area' ? fullAreaM2 * printingRate : printingRatePerRoll;
    const printing = {mode: c.printing.mode, areaM2: fullAreaM2, rate: printingRate, ratePerRoll: printingRatePerRoll, colors: c.printing.colors, cost: printingCost};
    if (c.printing.mode === 'tier') warnings.push('印刷阶梯采用工厂2020年模板：≤6色时，≥5轴200元/轴、<5轴300元/轴；≥7色时，>3轴300元/轴、≤3轴500元/轴。批次轴数仅选档，本结果计一轴；现行价格请核实，可人工覆盖。');
    if (c.printing.mode !== 'none') warnings.push('印刷费用仅按所选加工费计入；制版等额外费用未录入，成品克重未估算油墨增重。');
    const manualWeightArea = !blank(c.weight.areaM2);
    const weightAvailable = manualWeightArea || (c.bagType !== 'custom' && !c.bagging.standup);
    const weightAreaM2 = manualWeightArea ? c.weight.areaM2 : weightAvailable ? c.widthMm * c.heightMm * (c.bagType === 'back-seal' ? 1 : 2) / 1e6 : null;
    const weightLayers = layers.map(layer => ({material: layer.material, grams: weightAvailable ? weightAreaM2 * layer.thicknessUm * layer.density : null}));
    const filmGrams = weightAvailable ? weightLayers.reduce((sum, layer) => sum + layer.grams, 0) : null;
    const glueGrams = weightAvailable ? weightAreaM2 * CONSTANTS.glueGPerM2 * passes : null;
    const totalGrams = weightAvailable ? filmGrams + glueGrams : null;
    const weight = {available: weightAvailable, manualArea: manualWeightArea, areaM2: weightAreaM2, layers: weightLayers, filmGrams, glueGrams, totalGrams};
    if (!weightAvailable) warnings.push('此袋型含自立底或未确认折边：请填写单袋完整展开面积后计算成品克重；当前成本仍按实际膜宽和切长核算。');
    else warnings.push('含胶单袋克重将每道1.5g/㎡暂按成品留存干胶量估算，实际干胶量需核实；不含油墨、拉链等辅件重量。2%投料余量不增加成品理论克重。');
    const rollerWidthMm = c.filmWidthMm - CONSTANTS.rollerReductionMm;
    const glueAreaM2 = rollerWidthMm / 1000 * CONSTANTS.rollLengthM;
    const glueKgPerPass = glueAreaM2 * CONSTANTS.glueGPerM2 / 1000;
    const glueCostPerPass = glueKgPerPass * CONSTANTS.gluePricePerKg;
    const costPerPass = c.lamination.mode === 'area' ? fullAreaM2 * lamFee.rate : glueCostPerPass + CONSTANTS.laborPerPass;
    const laminationCost = costPerPass * passes;
    const baggingQuantity = c.bagging.basis === 'theoretical' ? theoreticalQuantity : c.bagging.basis === 'billable' ? billableQuantity : qualifiedQuantity;
    const baggingCost = baggingQuantity * bagFee.rate;
    const packagingCount = Math.ceil(billableQuantity / c.packaging.capacity);
    const packagingUnitCost = c.packaging.type === 'carton' ? CONSTANTS.cartonPrice + CONSTANTS.linerPrice + CONSTANTS.certificatePrice : CONSTANTS.pocketPrice + (c.packaging.certificate ? CONSTANTS.certificatePrice : 0);
    const packagingCost = packagingCount * packagingUnitCost;
    const totalCost = materialCost + printingCost + laminationCost + baggingCost + packagingCost;
    const unitCost = totalCost / billableQuantity;
    if (![materialCost, printingCost, laminationCost, baggingCost, packagingCost, totalCost, unitCost, totalActualKg, ...(weightAvailable ? [weightAreaM2, filmGrams, glueGrams, totalGrams] : [])].every(Number.isFinite)) return { ok: false, errors: ['成本或克重超过安全计算范围，请检查输入数值。'], warnings };
    if (c.packaging.type === 'carton' && !c.packaging.certificate) warnings.push('纸箱按固定纸箱4.10+套箱袋0.34+合格证0.10元/件计费；合格证开关仅适用于包装口袋。');
    if (c.name && /茶叶/.test(c.name)) warnings.push('茶叶示例的510mm三出排版、PE61μm及演示单价待核实；148mm为含背封搭接的展开宽，不再乘2。');
    const formulas = [
      '每轴长度 = 6000m（固定）；本结果按一轴核算，模板计价批量仅用于选择印刷及复合费率。',
      '单袋展开面积：三边封/四联平袋 = 宽mm × 长mm × 2 ÷ 1000000；中封 = 完整展开宽mm × 长mm ÷ 1000000，不再乘2；复杂袋型需手工确认完整展开面积。',
      '分层单袋克重g = 单袋展开面积㎡ × 厚度μm × 比重；不含胶克重 = 各层克重之和；含胶克重 = 不含胶克重 + 单袋展开面积㎡ × 1.5g/㎡ × 复合道数（暂按干胶留存估算）。',
      '各层理论kg = 层膜宽mm × 6000m × (厚度μm ÷ 1000) × 比重 ÷ 1000；最后一层内膜宽 = 复合膜宽 + 5mm。',
      '建议投料kg = 理论kg × 1.02；如有人工覆盖则采用人工kg；原膜费 = Σ(实际投料kg × 元/kg)。',
      '印刷费：无印刷 = 0；平米模式 = 印刷膜宽mm ÷ 1000 × 6000m × 元/㎡（默认0.50）；阶梯模式 = 所选元/轴 × 本次1轴，按色数及批次轴数选档，可人工覆盖。',
      '理论产量 = 6000 × 1000 ÷ 切长mm × 排版出数；理论整袋数 = 向下取整(理论产量)。',
      '预计合格数 = 向下取整(理论产量 × (1 − 损耗率%))；可结算数 = min(预计合格数, 订单可结算上限)，留空按全部合格数。',
      '综合计费面积/道 = 复合膜宽mm ÷ 1000 × 6000m；综合复合费 = 面积 × 元/㎡ × 道数。',
      '皮轴宽 = 复合膜宽 − 10mm；胶量面积/道 = 皮轴宽mm ÷ 1000 × 6000m；胶水kg/道 = 面积 × 1.5g/㎡ ÷ 1000。',
      '细算复合费 = (胶水kg/道 × 20.5元/kg + 200元人工水电/道) × 道数；与综合费二选一，绝不重复计入。',
      '制袋费 = 所选计费袋数 × (模板或手工基础单价 + 已选自立/拉链附加费)；默认按预计合格袋数。',
      '包装件数 = 向上取整(可结算数量 ÷ 每件装袋量)；纸箱每件4.10+0.34+0.10元；口袋每件1.56元+可选合格证0.10元。',
      '总成本 = 原膜费 + 印刷费 + 复合费 + 制袋费 + 包装费；单袋成本 = 总成本 ÷ 可结算数；无利润加成，不再乘1.07。',
      '计算保留未舍入精度，仅展示时保留小数；数量按上述方向取整，生产中多出的不可销售合格袋由当前订单承担。'
    ];
    return { ok: true, version: VERSION, config: c, errors: [], warnings: [...new Set(warnings)], layers, weight, printing, printingCost, rawQuantity, theoreticalQuantity, qualifiedQuantity, billableQuantity, unsoldQuantity, totalTheoreticalKg, totalActualKg, packagingCount, packagingUnitCost, materialCost, laminationCost, baggingCost, packagingCost, totalCost, unitCost,
      bagging: { ...bagFee, basis: c.bagging.basis, quantity: baggingQuantity, cost: baggingCost },
      lamination: { ...lamFee, mode: c.lamination.mode, fullAreaM2, rollerWidthMm, glueAreaM2, glueKgPerPass, glueCostPerPass, laborPerPass: CONSTANTS.laborPerPass, passes, costPerPass, cost: laminationCost, includedGlueCost: c.lamination.mode === 'detail' ? glueCostPerPass * passes : null, includedLaborCost: c.lamination.mode === 'detail' ? CONSTANTS.laborPerPass * passes : null },
      historicalComparison: { totalCost: 3969.83, actualPAKg: 48, actualPEKg: 197, materialCost: 3012.30, laminationCost: 303.60, baggingCost: 620, packagingCost: 33.93, billableQuantity: 62000, note: '原历史单3969.83元采用PA48kg、PE197kg的不同实投料、综合复合费303.60元、制袋620元及旧包装价33.93元。当前默认理论kg×1.02，包装按新固定价4.54元/件，因此不应强行对齐历史总额。' }, formulas };
  }
  return { VERSION, CONSTANTS, MATERIALS, BAG_TEMPLATES, LAMINATION_TEMPLATES, presets, defaultConfig, normalizeConfig, calculate, validate, bagFeeFor, laminationRateFor };
});
