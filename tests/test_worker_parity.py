"""Exercise identical requests against FastAPI and the production Worker module."""

import json
import os
from pathlib import Path
import random
import shutil
import subprocess

from fastapi.testclient import TestClient
import pytest

from app import app


ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = {
    "order_quantity": 30000,
    "production_quantity": 32000,
    "weight_per_piece_g": 2.1,
    "material_price_per_ton": 11250,
    "packaging_type": "carton",
    "pieces_per_package": 10000,
}
WEIGHT = {"width_mm": 300, "height_mm": 500, "thickness_mm": 0.03, "quantity": 50000}


def cases():
    samples = []

    def cost(**changes):
        samples.append({"path": "/calculate-cost", "body": {**EXAMPLE, **changes}})

    cost()
    cost(production_quantity=30000)
    for quantity in [1, 9999, 10000, 10001, 30001]:
        cost(order_quantity=quantity, production_quantity=quantity + 2000)
    cost(packaging_type="sack", pieces_per_package=5000)
    cost(packaging_type="none")
    cost(material_price_per_ton=100)
    cost(weight_per_piece_g="0.123456", material_price_per_ton="9876.54")
    cost(weight_per_piece_g="1_000", material_price_per_ton="1_125_0")
    cost(order_quantity=1, production_quantity=1_000_000_000,
         weight_per_piece_g=100000, material_price_per_ton=100000000, pieces_per_package=1)
    cost(order_quantity=1_000_000_000, production_quantity=1_000_000_000,
         weight_per_piece_g="99999.999999999999", material_price_per_ton="99999999.99999999")
    # Decimal half-even response rounding, including a negative net film cost.
    cost(order_quantity=1, production_quantity=1, weight_per_piece_g="0.00000005", material_price_per_ton="1000")
    rng = random.Random(4172026)
    for _ in range(100):
        order = rng.randint(1, 1_000_000_000)
        cost(order_quantity=order, production_quantity=rng.randint(order, 1_000_000_000),
             weight_per_piece_g=f"{rng.randint(1, 99999)}.{rng.randint(0, 999999):06d}",
             material_price_per_ton=f"{rng.randint(1, 99999999)}.{rng.randint(0, 9999):04d}",
             packaging_type=rng.choice(["carton", "sack", "none"]), pieces_per_package=rng.randint(1, 1_000_000_000))
    for changes in [
        {"order_quantity": 0}, {"order_quantity": -1}, {"order_quantity": True},
        {"order_quantity": "30000"}, {"order_quantity": 1.2}, {"order_quantity": 1000000001},
        {"production_quantity": 29999}, {"production_quantity": None},
        {"weight_per_piece_g": True}, {"weight_per_piece_g": None},
        {"weight_per_piece_g": []}, {"weight_per_piece_g": {}}, {"weight_per_piece_g": "NaN"},
        {"weight_per_piece_g": 0}, {"weight_per_piece_g": 100001},
        {"material_price_per_ton": "Infinity"}, {"material_price_per_ton": "-Infinity"},
        {"material_price_per_ton": False}, {"material_price_per_ton": None},
        {"material_price_per_ton": []}, {"material_price_per_ton": 100000001},
        {"pieces_per_package": 0}, {"pieces_per_package": 0.5}, {"pieces_per_package": True},
        {"packaging_type": "unknown"}, {"packaging_type": None},
        {"scrap_rate": 0.5}, {"input_factor": 1.5},
    ]:
        cost(**changes)
    samples.extend([
        {"path": "/calculate-cost", "body": {}},
        {"path": "/calculate-cost", "body": []},
        {"path": "/calculate-cost", "body": None},
        {"path": "/calculate-cost", "raw": "{"},
        {"path": "/calculate-cost", "raw": json.dumps({**EXAMPLE, "order_quantity": 30000.0})},
        {"path": "/calculate-cost", "method": "GET"},
        {"path": "/calculate-weight", "method": "GET"},
        {"path": "/health", "method": "GET"},
        {"path": "/health", "method": "POST", "body": {}},
        {"path": "/calculate-weight", "body": WEIGHT},
        {"path": "/calculate-weight", "body": {**WEIGHT, "density": 0.95}},
        {"path": "/calculate-weight", "body": {**WEIGHT, "quantity": "50000", "width_mm": "300"}},
        {"path": "/calculate-weight", "body": {**WEIGHT, "quantity": "3.0", "width_mm": "1_000"}},
        {"path": "/calculate-weight", "body": {**WEIGHT, "quantity": "1e3"}},
        {"path": "/calculate-weight", "body": {**WEIGHT, "width_mm": "0x10"}},
        {"path": "/calculate-weight", "body": {**WEIGHT, "width_mm": 0}},
        {"path": "/calculate-weight", "body": {**WEIGHT, "quantity": 1.5}},
        {"path": "/calculate-weight", "body": {**WEIGHT, "density": None}},
    ])
    for _ in range(100):
        samples.append({"path": "/calculate-weight", "body": {
            "width_mm": rng.uniform(10, 3000), "height_mm": rng.uniform(10, 5000),
            "thickness_mm": rng.uniform(0.005, 1), "density": rng.uniform(0.8, 1.5),
            "quantity": rng.randint(1, 100000000),
        }})
    return samples


CASES = cases()


@pytest.fixture(scope="module")
def worker_results():
    node = os.environ.get("NODE_BINARY") or shutil.which("node")
    if not node:
        fallback = Path("/Users/meidongshuo/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
        node = str(fallback) if fallback.exists() else None
    if not node:
        pytest.skip("Node.js is required for Worker/FastAPI parity verification")
    script = """
import { handleApi } from './worker/api.mjs';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const results = [];
for (const test of JSON.parse(input)) {
  const method = test.method || 'POST';
  const request = new Request('https://packpilot.test' + test.path, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: test.raw ?? JSON.stringify(test.body) }),
  });
  const response = await handleApi(request);
  results.push({ status: response.status, body: await response.json() });
}
if (await handleApi(new Request('https://packpilot.test/static/app.js')) !== null) {
  throw new Error('Non-API requests must pass through to the static router');
}
process.stdout.write(JSON.stringify(results));
"""
    result = subprocess.run([node, "--input-type=module", "-e", script], cwd=ROOT,
                            input=json.dumps(CASES), capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


@pytest.mark.parametrize("index", range(len(CASES)))
def test_worker_matches_fastapi(index, worker_results):
    sample = CASES[index]
    method = sample.get("method", "POST")
    content = sample.get("raw", json.dumps(sample.get("body")))
    with TestClient(app) as client:
        response = client.request(method, sample["path"],
                                  **({} if method == "GET" else {
                                      "content": content, "headers": {"Content-Type": "application/json"},
                                  }))
    actual = worker_results[index]
    assert actual["status"] == response.status_code, (sample, response.text, actual)
    expected = response.json()
    if response.status_code == 200:
        assert actual["body"].keys() == expected.keys()
        for key, value in expected.items():
            if isinstance(value, float):
                tolerance = 1e-10 if key == "unit_cost" else 1e-9
                assert abs(actual["body"][key] - value) <= tolerance, (sample, key, value, actual["body"][key])
            else:
                assert actual["body"][key] == value
    else:
        assert "detail" in actual["body"]
        if response.status_code == 422:
            assert isinstance(actual["body"]["detail"], list)
            assert all("loc" in error and "msg" in error and "type" in error for error in actual["body"]["detail"])
