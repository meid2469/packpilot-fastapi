"""Business-rule examples, boundaries, and legacy API compatibility."""

import pytest
from fastapi.testclient import TestClient

from app import app

client = TestClient(app)
EXAMPLE = {
    "order_quantity": 30000,
    "production_quantity": 32000,
    "weight_per_piece_g": 2.1,
    "material_price_per_ton": 11250,
    "packaging_type": "carton",
    "pieces_per_package": 10000,
}


def cost(**changes):
    response = client.post("/calculate-cost", json={**EXAMPLE, **changes})
    assert response.status_code == 200, response.text
    return response.json()


def test_confirmed_factory_example():
    data = cost()
    # Independent worked example, in kg and CNY, without intermediate rounding.
    assert data["film_weight_kg"] == 67.2
    assert data["input_weight_kg"] == 73.92
    assert data["scrap_weight_kg"] == 12.5664
    assert data["material_cost"] == 831.6
    assert data["scrap_credit"] == 85.45152
    assert data["net_film_cost"] == 746.14848
    assert data["making_cost"] == 192
    assert data["packaging_units"] == 3
    assert data["packaging_cost"] == 13.5
    assert data["total_cost"] == 951.64848
    assert data["unit_cost"] == pytest.approx(0.031721616, abs=1e-10)
    assert data["overproduction_cost"] == 58.63428
    assert data["overproduction_quantity"] == 2000
    assert data["rules_version"] == "zhenghao-pe-v1.0"
    assert data["warnings"]


def test_surplus_is_allocated_to_order_and_making_uses_production():
    same_quantity = cost(production_quantity=30000)
    surplus = cost()
    assert same_quantity["total_cost"] == 893.0142
    assert surplus["total_cost"] - same_quantity["total_cost"] == pytest.approx(58.63428)
    assert surplus["unit_cost"] == pytest.approx(surplus["total_cost"] / 30000)
    assert surplus["making_cost"] - same_quantity["making_cost"] == 12
    assert surplus["packaging_cost"] == same_quantity["packaging_cost"]
    assert same_quantity["warnings"] == []


@pytest.mark.parametrize("quantity,expected", [(1, 1), (9999, 1), (10000, 1), (10001, 2), (30001, 4)])
def test_partial_carton_rounds_up_for_delivery_only(quantity, expected):
    data = cost(order_quantity=quantity, production_quantity=quantity + 2000)
    assert data["packaging_units"] == expected
    assert data["packaging_cost"] == 4.5 * expected


def test_sack_and_no_packaging():
    sack = cost(packaging_type="sack", pieces_per_package=5000)
    assert sack["packaging_units"] == 6
    assert sack["packaging_cost"] == 9.36
    none = cost(packaging_type="none")
    assert none["packaging_units"] == 0
    assert none["packaging_cost"] == 0
    assert none["total_cost"] == 938.14848


@pytest.mark.parametrize("changes", [
    {"order_quantity": 0}, {"production_quantity": 0},
    {"production_quantity": 29999}, {"order_quantity": -1},
    {"order_quantity": 1.2}, {"order_quantity": True},
    {"production_quantity": "32000"}, {"order_quantity": 1000000001},
    {"weight_per_piece_g": 0}, {"weight_per_piece_g": -1},
    {"weight_per_piece_g": "NaN"}, {"material_price_per_ton": "Infinity"},
    {"material_price_per_ton": 0}, {"pieces_per_package": 0},
    {"pieces_per_package": 0.5}, {"packaging_type": "unknown"},
    {"scrap_rate": 0.5}, {"input_factor": 1.5},
])
def test_invalid_inputs_and_rule_override_are_rejected(changes):
    assert client.post("/calculate-cost", json={**EXAMPLE, **changes}).status_code == 422


def test_decimal_precision_and_recovery_warning():
    data = cost(weight_per_piece_g="0.123456", material_price_per_ton="9876.54")
    assert data["unit_cost"] == pytest.approx(0.0081132142, abs=1e-10)
    assert "请核对" in cost(material_price_per_ton=100)["warnings"][-1]


def test_web_assets_health_and_api_documentation():
    assert client.get("/").status_code == 200
    assert "PackPilot" in client.get("/").text
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/health").json()["status"] == "ok"
    paths = client.get("/openapi.json").json()["paths"]
    assert "/calculate-cost" in paths
    assert "/calculate-weight" in paths
    assert client.get("/docs").status_code == 200


def test_original_weight_api_default_density_and_validation():
    payload = {"width_mm": 300, "height_mm": 500, "thickness_mm": 0.03, "quantity": 50000}
    assert client.post("/calculate-weight", json=payload).json() == {
        "area_m2": 0.3, "weight_per_piece_g": 8.37, "total_weight_kg": 418.5,
    }
    assert client.post("/calculate-weight", json={**payload, "width_mm": 0}).status_code == 422
