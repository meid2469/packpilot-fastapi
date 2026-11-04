from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from pydantic import BaseModel, Field

from costing import CostCalculationRequest, CostCalculationResponse, calculate_cost


app = FastAPI(title="PackPilot Costing & Weight Calculator", version="1.0.0")
STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


@app.get("/health")
def health():
    return {"status": "ok", "service": "packpilot", "version": "1.0.0"}


app.post("/calculate-cost", response_model=CostCalculationResponse)(calculate_cost)


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
