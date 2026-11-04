// Shared HTTP contract for the Worker deployment. FastAPI remains available unchanged.
const COST_FIELDS = new Set([
  "order_quantity", "production_quantity", "weight_per_piece_g",
  "material_price_per_ton", "packaging_type", "pieces_per_package",
]);
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
});
const rat = (n, d = 1n) => ({ n: BigInt(n), d: BigInt(d) });
const add = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
const div = (a, b) => rat(a.n * b.d, a.d * b.n);
const compare = (a, b) => a.n * b.d - b.n * a.d;

function decimal(value) {
  if ((typeof value !== "string" && typeof value !== "number") ||
      (typeof value === "number" && !Number.isFinite(value))) return null;
  const text = String(value).trim().replaceAll("_", "");
  // Bound pathological numeric strings without limiting ordinary decimal inputs.
  if (text.length > 10000) return null;
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match) return null;
  const exponent = Number(match[5] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10000) return null;
  const fraction = match[3] ?? match[4] ?? "";
  const digits = (match[2] || "0") + fraction;
  const shift = exponent - fraction.length;
  const numerator = BigInt(digits) * (match[1] === "-" ? -1n : 1n);
  return shift >= 0 ? rat(numerator * 10n ** BigInt(shift)) : rat(numerator, 10n ** BigInt(-shift));
}

// Decimal ROUND_HALF_EVEN, with no intermediate floating point conversion.
function rounded(value, places = 10) {
  const scale = 10n ** BigInt(places);
  const sign = value.n < 0n ? -1n : 1n;
  const scaled = (value.n < 0n ? -value.n : value.n) * scale;
  let quotient = scaled / value.d;
  const twiceRemainder = (scaled % value.d) * 2n;
  if (twiceRemainder > value.d || (twiceRemainder === value.d && quotient % 2n === 1n)) quotient += 1n;
  const result = (quotient * sign).toString();
  const negative = result.startsWith("-");
  const digits = (negative ? result.slice(1) : result).padStart(places + 1, "0");
  return Number(`${negative ? "-" : ""}${digits.slice(0, -places)}.${digits.slice(-places)}`);
}

// Python round(float, 10) rounds the exact binary value, including half-even ties.
function roundFloat(value) {
  if (value === 0) return 0;
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const exponentBits = Number((bits >> 52n) & 2047n);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = (exponentBits ? (1n << 52n) | fraction : fraction) * (bits >> 63n ? -1n : 1n);
  const exponent = (exponentBits || 1) - 1023 - 52;
  return rounded(exponent >= 0 ? rat(mantissa << BigInt(exponent)) : rat(mantissa, 1n << BigInt(-exponent)));
}

function issue(field, message, type = "value_error", input) {
  return { type, loc: field ? ["body", field] : ["body"], msg: message, ...(input === undefined ? {} : { input }) };
}

// Preserve JSON integer tokens for Pydantic strict integer fields: 3.0 is a float.
function rootTokens(text) {
  const result = new Map();
  let i = 0;
  const whitespace = () => { while (/\s/.test(text[i] || "x")) i++; };
  const stringEnd = () => {
    i++;
    while (i < text.length) {
      if (text[i] === "\\") i += 2;
      else if (text[i++] === '"') break;
    }
  };
  whitespace();
  if (text[i++] !== "{") return result;
  while (i < text.length) {
    whitespace();
    if (text[i] === "}") break;
    const keyStart = i;
    stringEnd();
    const key = JSON.parse(text.slice(keyStart, i));
    whitespace();
    i++; // colon (JSON.parse already validated syntax)
    whitespace();
    const start = i;
    let depth = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') { stringEnd(); continue; }
      if ((c === "," || c === "}") && depth === 0) break;
      if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
      i++;
    }
    result.set(key, text.slice(start, i).trim());
    if (text[i++] === "}") break;
  }
  return result;
}

function validateCost(payload, tokens) {
  const errors = [];
  for (const field of Object.keys(payload)) {
    if (!COST_FIELDS.has(field)) errors.push(issue(field, "Extra inputs are not permitted", "extra_forbidden", payload[field]));
  }
  const values = { packaging_type: "carton", pieces_per_package: 10000, ...payload };
  for (const field of ["order_quantity", "production_quantity", "pieces_per_package"]) {
    const value = values[field];
    const token = tokens.get(field);
    if (value === undefined) errors.push(issue(field, "Field required", "missing"));
    else if (!Number.isSafeInteger(value) || (token && !/^-?(?:0|[1-9]\d*)$/.test(token))) {
      errors.push(issue(field, "Input should be a valid integer", "int_type", value));
    } else if (value <= 0 || value > 1e9) errors.push(issue(field, "Input should be greater than 0 and at most 1000000000", "value_error", value));
  }
  for (const [field, maximum] of [["weight_per_piece_g", 100000], ["material_price_per_ton", 100000000]]) {
    const value = values[field];
    const parsed = decimal(value);
    if (value === undefined) errors.push(issue(field, "Field required", "missing"));
    else if (!parsed || parsed.n <= 0n || compare(parsed, rat(maximum)) > 0n) {
      errors.push(issue(field, `Input should be a finite positive decimal at most ${maximum}`, "value_error", value));
    } else values[field] = parsed;
  }
  if (!["carton", "sack", "none"].includes(values.packaging_type)) {
    errors.push(issue("packaging_type", "Input should be 'carton', 'sack' or 'none'", "literal_error", values.packaging_type));
  }
  if (!errors.length && values.production_quantity < values.order_quantity) {
    errors.push(issue(null, "Value error, 预计合格生产数量不能少于客户订货数量", "value_error", payload));
  }
  return { values, errors };
}

function calculateCost(values) {
  const order = values.order_quantity;
  const production = values.production_quantity;
  const extra = production - order;
  const film = div(mul(values.weight_per_piece_g, rat(production)), rat(1000));
  const input = mul(film, rat(110, 100));
  const scrap = mul(input, rat(17, 100));
  const material = div(mul(input, values.material_price_per_ton), rat(1000));
  const credit = mul(scrap, rat(68, 10));
  const net = sub(material, credit);
  const making = mul(rat(production), rat(6, 1000));
  const units = values.packaging_type === "none" ? 0 : Math.ceil(order / values.pieces_per_package);
  const packagePrice = { carton: rat(450, 100), sack: rat(156, 100), none: rat(0) }[values.packaging_type];
  const packaging = mul(rat(units), packagePrice);
  const total = add(add(net, making), packaging);
  const warnings = [];
  const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (extra) warnings.push(`超产 ${thousands(extra)} 个无法销售，其生产成本全部由本单 ${thousands(order)} 个承担。`);
  if (net.n < 0n) warnings.push("原料价格低于本模型的边料回收抵扣，请核对原料价格及单位。");
  return {
    rules_version: "zhenghao-pe-v1.0", order_quantity: order, production_quantity: production,
    overproduction_quantity: extra, film_weight_kg: rounded(film), input_weight_kg: rounded(input),
    scrap_weight_kg: rounded(scrap), material_cost: rounded(material), scrap_credit: rounded(credit),
    net_film_cost: rounded(net), making_cost: rounded(making), packaging_units: units,
    packaging_unit_cost: rounded(packagePrice), packaging_cost: rounded(packaging), total_cost: rounded(total),
    unit_cost: rounded(div(total, rat(order))),
    overproduction_cost: rounded(div(mul(add(net, making), rat(extra)), rat(production))), warnings,
  };
}

function calculateWeight(payload) {
  const values = { density: 0.93, ...payload };
  const errors = [];
  for (const field of ["width_mm", "height_mm", "thickness_mm", "quantity", "density"]) {
    const raw = values[field];
    // The original weight endpoint permits numeric strings and boolean coercion.
    const validType = ["number", "string", "boolean"].includes(typeof raw);
    const text = typeof raw === "string" ? raw.trim().replaceAll("_", "") : null;
    const validText = text === null || (field === "quantity"
      ? /^[+-]?\d+(?:\.0+)?$/.test(text)
      : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text));
    const value = validType && validText ? Number(text ?? raw) : NaN;
    if (!Number.isFinite(value) || value <= 0 || (field === "quantity" && !Number.isInteger(value))) {
      errors.push(issue(field, "Input should be a finite positive number", "value_error", raw));
    } else values[field] = value;
  }
  if (errors.length) return json({ detail: errors }, 422);
  const area = values.width_mm * values.height_mm * 2 / 1000000;
  const weight = area * values.thickness_mm * values.density * 1000;
  const total = weight * values.quantity / 1000;
  if (![area, weight, total].every(Number.isFinite)) return json({ detail: [issue(null, "Calculation exceeds finite range")] }, 422);
  return json({ area_m2: roundFloat(area), weight_per_piece_g: roundFloat(weight), total_weight_kg: roundFloat(total) });
}

export async function handleApi(request) {
  const path = new URL(request.url).pathname;
  if (path === "/health") {
    if (request.method !== "GET") return json({ detail: "Method Not Allowed" }, 405, { Allow: "GET" });
    return json({ status: "ok", service: "packpilot", version: "1.0.0" });
  }
  if (path !== "/calculate-cost" && path !== "/calculate-weight") return null;
  if (request.method !== "POST") return json({ detail: "Method Not Allowed" }, 405, { Allow: "POST" });
  let payload, tokens;
  try {
    const text = await request.text();
    payload = JSON.parse(text);
    if (!payload || Array.isArray(payload) || typeof payload !== "object") {
      return json({ detail: [issue(null, "Input should be a valid dictionary", "model_attributes_type")] }, 422);
    }
    tokens = rootTokens(text);
  } catch {
    return json({ detail: [issue(null, "JSON decode error", "json_invalid")] }, 422);
  }
  if (path === "/calculate-weight") return calculateWeight(payload);
  const { values, errors } = validateCost(payload, tokens);
  return errors.length ? json({ detail: errors }, 422) : json(calculateCost(values));
}
