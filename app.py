from fastapi import FastAPI
from pydantic import BaseModel, Field


app = FastAPI(title="PackPilot Weight Calculator")


class WeightCalculationRequest(BaseModel):
    width_mm: float = Field(gt=0)
    height_mm: float = Field(gt=0)
    thickness_mm: float = Field(gt=0)
    quantity: int = Field(gt=0)
    density: float = Field(default=0.93, gt=0)


class WeightCalculationResponse(BaseModel):
    area_m2: float
    weight_per_piece_g: float
    total_weight_kg: float


@app.post("/calculate-weight", response_model=WeightCalculationResponse)
def calculate_weight(payload: WeightCalculationRequest) -> WeightCalculationResponse:
    area_m2 = payload.width_mm * payload.height_mm * 2 / 1_000_000
    weight_per_piece_g = area_m2 * payload.thickness_mm * payload.density * 1000
    total_weight_kg = weight_per_piece_g * payload.quantity / 1000

    return WeightCalculationResponse(
        area_m2=round(area_m2, 10),
        weight_per_piece_g=round(weight_per_piece_g, 10),
        total_weight_kg=round(total_weight_kg, 10),
    )
