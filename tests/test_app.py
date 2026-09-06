from fastapi.testclient import TestClient

from app import app


client = TestClient(app)


def test_calculate_weight() -> None:
    response = client.post(
        "/calculate-weight",
        json={
            "width_mm": 300,
            "height_mm": 500,
            "thickness_mm": 0.03,
            "quantity": 50000,
            "density": 0.93,
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "area_m2": 0.3,
        "weight_per_piece_g": 8.37,
        "total_weight_kg": 418.5,
    }
