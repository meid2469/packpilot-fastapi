"""Zhenghao V1 costing; use Decimal and round only at the response boundary."""

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


RULES_VERSION = "zhenghao-pe-v1.0"
INPUT_FACTOR = Decimal("1.10")
SCRAP_RATE = Decimal("0.17")
SCRAP_PRICE_PER_KG = Decimal("6.8")  # 3.4 yuan / Chinese jin (500 g)
MAKING_PRICE = Decimal("0.006")
PACKAGE_PRICES = {"carton": Decimal("4.50"), "sack": Decimal("1.56"), "none": Decimal(0)}


class CostCalculationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    order_quantity: int = Field(gt=0, le=1_000_000_000, strict=True)
    production_quantity: int = Field(gt=0, le=1_000_000_000, strict=True)
    weight_per_piece_g: Decimal = Field(gt=0, le=100_000)
    material_price_per_ton: Decimal = Field(gt=0, le=100_000_000)
    packaging_type: Literal["carton", "sack", "none"] = "carton"
    pieces_per_package: int = Field(default=10_000, gt=0, le=1_000_000_000, strict=True)

    @model_validator(mode="after")
    def sufficient_production(self):
        if self.production_quantity < self.order_quantity:
            raise ValueError("预计合格生产数量不能少于客户订货数量")
        return self


class CostCalculationResponse(BaseModel):
    rules_version: str
    order_quantity: int
    production_quantity: int
    overproduction_quantity: int
    film_weight_kg: float
    input_weight_kg: float
    scrap_weight_kg: float
    material_cost: float
    scrap_credit: float
    net_film_cost: float
    making_cost: float
    packaging_units: int
    packaging_unit_cost: float
    packaging_cost: float
    total_cost: float
    unit_cost: float
    overproduction_cost: float
    warnings: list[str]


def calculate_cost(payload: CostCalculationRequest) -> CostCalculationResponse:
    order = payload.order_quantity
    production = payload.production_quantity
    film = payload.weight_per_piece_g * production / 1000
    material_input = film * INPUT_FACTOR
    # The factory's recovery allowance is based on total blowing input.
    # Do not divide film weight by (1 - scrap_rate), or add scrap as another loss.
    scrap = material_input * SCRAP_RATE
    material_cost = material_input * payload.material_price_per_ton / 1000
    scrap_credit = scrap * SCRAP_PRICE_PER_KG
    net_film_cost = material_cost - scrap_credit
    making_cost = MAKING_PRICE * production
    units = (order + payload.pieces_per_package - 1) // payload.pieces_per_package
    if payload.packaging_type == "none":
        units = 0
    package_price = PACKAGE_PRICES[payload.packaging_type]
    packaging_cost = units * package_price
    total_cost = net_film_cost + making_cost + packaging_cost
    extra = production - order
    warnings = []
    if extra:
        warnings.append(f"超产 {extra:,} 个无法销售，其生产成本全部由本单 {order:,} 个承担。")
    if net_film_cost < 0:
        warnings.append("原料价格低于本模型的边料回收抵扣，请核对原料价格及单位。")

    def number(value: Decimal) -> float:
        return float(round(value, 10))

    return CostCalculationResponse(
        rules_version=RULES_VERSION,
        order_quantity=order,
        production_quantity=production,
        overproduction_quantity=extra,
        film_weight_kg=number(film),
        input_weight_kg=number(material_input),
        scrap_weight_kg=number(scrap),
        material_cost=number(material_cost),
        scrap_credit=number(scrap_credit),
        net_film_cost=number(net_film_cost),
        making_cost=number(making_cost),
        packaging_units=units,
        packaging_unit_cost=number(package_price),
        packaging_cost=number(packaging_cost),
        total_cost=number(total_cost),
        unit_cost=number(total_cost / order),
        overproduction_cost=number((net_film_cost + making_cost) * extra / production),
        warnings=warnings,
    )
