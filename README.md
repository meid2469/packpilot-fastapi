# PackPilot FastAPI Service

A minimal FastAPI service that calculates packaging weight from bag dimensions,
material thickness, quantity, and density.

## Local setup

Requires Python 3.10 or newer.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

On Windows PowerShell, activate the environment with:

```powershell
.venv\Scripts\Activate.ps1
```

## Run the API

```bash
uvicorn app:app --reload
```

The API will be available at `http://127.0.0.1:8000`. Interactive documentation
is available at `http://127.0.0.1:8000/docs`.

## Example request

```bash
curl -X POST http://127.0.0.1:8000/calculate-weight \
  -H "Content-Type: application/json" \
  -d '{
    "width_mm": 300,
    "height_mm": 500,
    "thickness_mm": 0.03,
    "quantity": 50000,
    "density": 0.93
  }'
```

Expected response:

```json
{
  "area_m2": 0.3,
  "weight_per_piece_g": 8.37,
  "total_weight_kg": 418.5
}
```

`density` is optional and defaults to `0.93`.

## Run the test

```bash
pytest
```
