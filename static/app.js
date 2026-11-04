"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("cost-form");
  const status = $("calculation-status");
  const integerFields = ["order_quantity", "production_quantity", "pieces_per_package"];
  const costFields = [...integerFields, "weight_per_piece_g", "material_price_per_ton"];
  const labels = {
    order_quantity: "客户订货数量", production_quantity: "预计合格生产数量",
    pieces_per_package: "每个包装单位装袋数量", weight_per_piece_g: "冲切前单袋克重",
    material_price_per_ton: "原料价格",
  };
  const number = (value, digits = 2) => Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
  const money = (value) => `¥${number(value)}`;
  const packageNames = {carton: "纸箱", sack: "包装口袋", none: "不计包装"};
  let currentResult = null;
  let currentInput = null;
  let requestNumber = 0;
  let controller;
  let timer;
  let weightRequestNumber = 0;
  let weightController;

  function setStatus(text, state = "") {
    status.textContent = text;
    status.className = `calculation-status ${state}`;
  }

  function clearResult() {
    currentResult = null;
    currentInput = null;
    ["unit-cost", "total-cost", "overproduction-quantity", "net-film-cost", "material-cost", "scrap-credit", "making-cost", "packaging-cost", "breakdown-total", "film-weight", "input-weight", "scrap-weight"].forEach((id) => { $(id).textContent = "—"; });
    $("calculation-basis").textContent = "全部成本 ÷ 客户订货数量";
    $("making-formula").textContent = "预计合格生产数量 × 0.006 元";
    $("packaging-formula").textContent = "按交付数量向上取整";
    $("overproduction-note").textContent = "超产的净膜与制袋成本一并计入本单。";
    $("result-warnings").hidden = true;
    $("copy-result").disabled = true;
    $("export-result").disabled = true;
    $("action-feedback").textContent = "";
    ["film-bar", "making-bar", "packaging-bar"].forEach((id) => { $(id).style.width = "0%"; });
  }

  function showError(message) {
    clearResult();
    $("result-error").textContent = message;
    $("result-error").hidden = false;
    setStatus("请检查输入", "error");
  }

  function readInput() {
    const result = {};
    const packaging = form.elements.packaging_type.value;
    costFields.forEach((key) => { $(key).removeAttribute("aria-invalid"); });
    for (const key of costFields) {
      if (key === "pieces_per_package" && packaging === "none") {
        result[key] = 10000;
        continue;
      }
      const input = $(key);
      const value = Number(input.value);
      const max = Number(input.max);
      if (!input.value.trim() || !Number.isFinite(value) || value <= 0 || value > max || (integerFields.includes(key) && !Number.isInteger(value))) {
        input.setAttribute("aria-invalid", "true");
        throw new Error(`请填写有效的${labels[key]}${integerFields.includes(key) ? "（正整数）" : "（大于 0）"}。`);
      }
      result[key] = value;
    }
    if (result.production_quantity < result.order_quantity) {
      $("production_quantity").setAttribute("aria-invalid", "true");
      throw new Error("预计合格生产数量不能少于客户订货数量。");
    }
    result.packaging_type = packaging;
    return result;
  }

  function renderResult(data, input) {
    currentResult = data;
    currentInput = {...input, material_type: $("material_type").value};
    $("unit-cost").textContent = number(data.unit_cost, 6);
    $("total-cost").textContent = money(data.total_cost);
    $("overproduction-quantity").textContent = `${number(data.overproduction_quantity, 0)} 个`;
    $("calculation-basis").textContent = `${money(data.total_cost)} ÷ ${number(data.order_quantity, 0)} 个客户订货数量`;
    const values = {"net-film-cost": data.net_film_cost, "material-cost": data.material_cost, "scrap-credit": data.scrap_credit, "making-cost": data.making_cost, "packaging-cost": data.packaging_cost, "breakdown-total": data.total_cost};
    Object.entries(values).forEach(([id, value]) => { $(id).textContent = money(value); });
    $("making-formula").textContent = `${number(data.production_quantity, 0)} 个 × 0.006 元`;
    const unitName = input.packaging_type === "carton" ? "箱" : "包";
    $("packaging-formula").textContent = input.packaging_type === "none" ? "本单不计包装费用" : `${number(data.packaging_units, 0)} ${unitName} × ${number(data.packaging_unit_cost)} 元（每${unitName} ${number(input.pieces_per_package, 0)} 个）`;
    $("film-weight").textContent = number(data.film_weight_kg, 4);
    $("input-weight").textContent = number(data.input_weight_kg, 4);
    $("scrap-weight").textContent = number(data.scrap_weight_kg, 4);
    $("overproduction-note").textContent = data.overproduction_quantity > 0 ? `其中超产 ${number(data.overproduction_quantity, 0)} 个的净膜与制袋成本为 ${money(data.overproduction_cost)}，已全部计入本单。` : "本单预计合格生产数量等于客户订货数量，无超产成本。";
    const warnings = $("result-warnings");
    warnings.replaceChildren();
    (data.warnings || []).forEach((message) => {
      const p = document.createElement("p");
      p.textContent = message;
      warnings.appendChild(p);
    });
    warnings.hidden = !warnings.childElementCount;
    const segments = [Math.max(0, data.net_film_cost), Math.max(0, data.making_cost), Math.max(0, data.packaging_cost)];
    const visualTotal = segments.reduce((sum, value) => sum + value, 0);
    ["film-bar", "making-bar", "packaging-bar"].forEach((id, index) => {
      $(id).style.width = `${visualTotal ? segments[index] / visualTotal * 100 : 0}%`;
    });
    $("copy-result").disabled = false;
    $("export-result").disabled = false;
    $("result-error").hidden = true;
    setStatus("已自动核算");
  }

  async function calculate() {
    const sequence = ++requestNumber;
    controller?.abort();
    let input;
    try { input = readInput(); } catch (error) {
      showError(error.message);
      return;
    }
    clearResult();
    $("result-error").hidden = true;
    setStatus("正在核算", "pending");
    const requestController = new AbortController();
    controller = requestController;
    const timeout = window.setTimeout(() => requestController.abort(), 15000);
    try {
      const response = await fetch("/calculate-cost", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(input), signal: requestController.signal,
      });
      if (sequence !== requestNumber) return;
      if (!response.ok) {
        if (response.status === 422) throw new Error("核价参数未通过检查，请核对数量、克重与原料价格的填写范围。");
        throw new Error("核价服务暂时不可用，请稍后点击“重新核算”。");
      }
      const data = await response.json();
      if (sequence !== requestNumber) return;
      if (!Number.isFinite(data.unit_cost) || !Number.isFinite(data.total_cost)) throw new Error("核价结果暂时不可用，请重新核算。");
      renderResult(data, input);
    } catch (error) {
      if (sequence !== requestNumber) return;
      showError(error.name === "AbortError" ? "核算连接超时，请稍后点击“重新核算”。" : error instanceof TypeError ? "无法连接核价服务，请检查网络后重新核算。" : error.message);
    } finally { window.clearTimeout(timeout); }
  }

  function scheduleCalculation() {
    window.clearTimeout(timer);
    ++requestNumber;
    controller?.abort();
    clearResult();
    $("result-error").hidden = true;
    setStatus("等待核算", "pending");
    timer = window.setTimeout(calculate, 400);
  }

  function updatePackaging() {
    const type = form.elements.packaging_type.value;
    $("pieces_per_package").disabled = type === "none";
    $("package-capacity-label").textContent = type === "sack" ? "每个包装口袋装袋数量" : "每箱装袋数量";
    $("packaging-note").textContent = type === "carton" ? "纸箱 4.10 + 套箱袋 0.30 + 合格证 0.10 = 4.50 元 / 箱；不足一箱按整箱计。" : type === "sack" ? "每个包装口袋 1.56 元；不足一个包装单位按整包计。" : "本单包装费用按 0 元计，不影响膜料与制袋费用。";
  }

  form.addEventListener("input", (event) => {
    const target = event.target;
    if (target.name === "packaging_type") updatePackaging();
    if (costFields.includes(target.name) || target.name === "packaging_type") scheduleCalculation();
    if (target.id === "material_type" && currentInput) currentInput.material_type = target.value;
    if (["width_mm", "height_mm", "thickness_mm", "density"].includes(target.id)) {
      ++weightRequestNumber;
      weightController?.abort();
      $("weight-result").textContent = "参数已修改，请重新校验理论克重。";
      $("weight-result").classList.remove("error");
      $("check-weight").disabled = false;
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(timer);
    calculate();
  });
  $("reset-example").addEventListener("click", () => {
    form.reset();
    updatePackaging();
    $("weight-result").textContent = "";
    ++weightRequestNumber;
    weightController?.abort();
    $("check-weight").disabled = false;
    window.clearTimeout(timer);
    calculate();
  });

  $("check-weight").addEventListener("click", async () => {
    const sequence = ++weightRequestNumber;
    weightController?.abort();
    const result = $("weight-result");
    result.classList.remove("error");
    const payload = {quantity: 1};
    for (const key of ["width_mm", "height_mm", "thickness_mm", "density"]) {
      const input = $(key);
      if (!input.value.trim() || !Number.isFinite(Number(input.value)) || Number(input.value) <= 0) {
        result.textContent = "请填写大于 0 的宽度、长度、单层厚度和密度。";
        result.classList.add("error");
        input.focus();
        return;
      }
      payload[key] = Number(input.value);
    }
    const requestController = new AbortController();
    weightController = requestController;
    const timeout = window.setTimeout(() => requestController.abort(), 15000);
    $("check-weight").disabled = true;
    result.textContent = "正在校验…";
    try {
      const response = await fetch("/calculate-weight", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(payload), signal: requestController.signal});
      if (!response.ok) throw new Error("无法完成克重校验，请检查参数后重试。");
      const data = await response.json();
      if (sequence !== weightRequestNumber) return;
      if (!Number.isFinite(data.weight_per_piece_g)) throw new Error("理论克重结果无效，请检查参数后重试。");
      result.textContent = `理论克重 ${number(data.weight_per_piece_g, 4)} g / 个；膜面积 ${number(data.area_m2, 4)} m²。核价仍使用上方填写的冲切前克重。`;
    } catch (error) {
      if (sequence !== weightRequestNumber) return;
      result.textContent = error.name === "AbortError" ? "克重校验连接超时，请重试。" : error instanceof TypeError ? "无法连接克重校验服务，请检查网络后重试。" : error.message;
      result.classList.add("error");
    } finally {
      window.clearTimeout(timeout);
      if (sequence === weightRequestNumber) $("check-weight").disabled = false;
    }
  });

  function resultRows() {
    const d = currentResult;
    const p = currentInput;
    if (!d || !p) return [];
    return [
      ["项目", "数值", "单位或说明"], ["工具", "PackPilot Costing", "正浩包装 PE 背心袋"],
      ["规则版本", d.rules_version, ""], ["PE 种类", p.material_type, "备注，不自动调整原料价格或克重"],
      ["客户订货数量", p.order_quantity, "个"], ["预计合格生产数量", p.production_quantity, "个"],
      ["超产数量", d.overproduction_quantity, "个，全部成本由本单承担"], ["冲切前单袋克重", p.weight_per_piece_g, "g / 个"],
      ["原料价格", p.material_price_per_ton, "元 / 吨"], ["吹膜投料系数", "1.10", ""],
      ["边料率", "17%", "以吹膜投料重量为基数"], ["边料回收价", "6.8", "元 / kg，等于 3.4 元 / 斤"],
      ["制袋单价", "0.006", "元 / 个，按预计合格生产数量"],
      ["冲切前膜料重量", d.film_weight_kg, "kg"], ["吹膜投料重量", d.input_weight_kg, "kg"],
      ["可回收边料重量", d.scrap_weight_kg, "kg"], ["全部投料原料成本", d.material_cost, "元"],
      ["边料回收抵扣", d.scrap_credit, "元"], ["净膜成本", d.net_film_cost, "元"], ["制袋费", d.making_cost, "元"],
      ["包装方式", packageNames[p.packaging_type], ""], ["每包装单位数量", p.packaging_type === "none" ? "不适用" : p.pieces_per_package, "个"],
      ["包装单位数", d.packaging_units, "按客户订货数量向上取整"], ["包装单价", d.packaging_unit_cost, "元 / 包装单位"],
      ["包装费", d.packaging_cost, "元"], ["超产净膜及制袋成本", d.overproduction_cost, "元，已计入总成本"],
      ["本单总成本", d.total_cost, "元"], ["单袋工厂成本", d.unit_cost, "元 / 个，以客户订货数量分摊"],
      ["费用范围", "净膜成本 + 制袋费 + 包装费", "利润、税费、运费及其他未录入费用另计"],
    ];
  }

  $("copy-result").addEventListener("click", async () => {
    if (!currentResult) return;
    const text = resultRows().slice(1).map(([label, value, unit]) => `${label}：${value}${unit ? ` ${unit}` : ""}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      $("action-feedback").textContent = "已复制核价结果与计算口径。";
    } catch {
      $("action-feedback").textContent = "浏览器未允许复制，请使用“导出 CSV”保存本次核价。";
    }
  });
  $("export-result").addEventListener("click", () => {
    if (!currentResult) return;
    const csv = "\uFEFF" + resultRows().map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8;"}));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `PackPilot-核价-${new Date().toLocaleDateString("sv-SE")}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("action-feedback").textContent = "已导出本次核价 CSV，可用 Excel 打开。";
  });

  updatePackaging();
  calculate();
})();
