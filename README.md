# PackPilot Costing · 正浩包装核价器

PE 背心袋核价网页，支持手机和电脑。输入冲切前实测克重、原料价格、订货量、预计合格生产数量及包装方式，自动展示投料、回收抵扣、制袋、包装和本单单位成本。

第一版固定袋型为 PE 背心袋；PE 品类是订单备注。可选尺寸/单层厚度校验仅计算理论克重，不覆盖实测克重。结果为成本试算，未加入利润、税费、运费、印刷及其他工艺费用。

## 正浩工厂规则 V1.0

规则版本：`zhenghao-pe-v1.0`。2026-11-05 确认边料基数为**吹膜投料重量**。

| 项目 | 规则 |
| --- | --- |
| 冲切前膜重量 kg | 单袋冲切前克重 g × 预计合格生产数量 ÷ 1000 |
| 吹膜投料 kg | 冲切前膜重量 × 1.10 |
| 边料 kg | 吹膜投料重量 × 17% |
| 投料成本 元 | 吹膜投料 kg × 原料吨价 ÷ 1000 |
| 回收抵扣 元 | 边料 kg × 6.8（3.4 元/斤，1 斤 = 0.5 kg） |
| 净膜成本 元 | 投料成本 − 回收抵扣 |
| 制袋费 元 | 预计合格生产数量 × 0.006 |
| 包装单位数 | 客户订货数量 ÷ 每包数量，向上取整 |
| 纸箱 元/箱 | 4.1 + 套箱袋 0.3 + 合格证 0.1 = 4.5 |
| 包装口袋 元/包 | 1.56 |
| 本单成本 元 | 净膜成本 + 制袋费 + 包装费 |
| 单袋成本 元/个 | 本单成本 ÷ 客户订货数量 |

超产部分无法销售，全部成本由本单承担；包装仅按客户交付数量计算。界面假定交付数量等于订货量，预计合格产量不得少于订货量。不再额外加入一次 17% 损耗，也不按成品重量反推投料。

后端使用十进制运算，不进行中间金额舍入；API 最终保留至多 10 位小数，界面总额显示 2 位、单袋显示 6 位。`overproduction_cost` 是超产增加的净膜及制袋成本，不含交付包装。

### 验算示例

订货 30,000 个，预计合格生产 32,000 个，冲切前克重 2.1 g，原料 11,250 元/吨，纸箱每箱 10,000 个：

| 项目 | 结果 |
| --- | ---: |
| 冲切前膜重量 | 67.2 kg |
| 吹膜投料 | 73.92 kg |
| 边料重量 | 12.5664 kg |
| 投料成本 | ¥831.60 |
| 回收抵扣 | ¥85.45152 |
| 净膜成本 | ¥746.14848 |
| 制袋费 | ¥192.00 |
| 包装费（3 箱） | ¥13.50 |
| 本单成本 | **¥951.64848** |
| 单袋成本 | **¥0.031721616** |

## 网页与部署

启动下方 FastAPI 服务后，浏览器打开 `http://127.0.0.1:8000` 即可使用网页。

- `GET /`：核价页面。
- `POST /calculate-cost`：新增核价接口。
- `POST /calculate-weight`：原克重接口，字段、公式、默认密度和返回格式保持兼容。
- `GET /docs`、`GET /openapi.json`：接口文档。
- `GET /health`：健康检查。

```bash
curl -X POST http://127.0.0.1:8000/calculate-cost \
  -H 'Content-Type: application/json' \
  -d '{"order_quantity":30000,"production_quantity":32000,"weight_per_piece_g":2.1,"material_price_per_ton":11250,"packaging_type":"carton","pieces_per_package":10000}'
```

包装方式可取 `carton`、`sack`、`none`，不允许请求覆盖工厂固定系数。无效参数返回 HTTP 422。

**Sites 云端版本**使用同源 Worker 兼容层 `worker/api.mjs` 提供相同接口，前端与 FastAPI 共用 `static/`。构建时从 FastAPI 生成 OpenAPI，将静态资源与 API 打包为一个 Worker；云端不启动 Python 进程。`.openai/hosting.json` 记录站点身份，初始为仅所有者可访问。

```bash
node scripts/build-worker.mjs
```

构建需先安装 Python 依赖，可用 `PACKPILOT_PYTHON` 指定解释器。产物在 `dist/`，通过 Sites 发布。

直接部署 FastAPI 可使用 `Dockerfile`，或在 Render 使用 `render.yaml` 创建服务（需连接 Render 账号）。启动命令：`uvicorn app:app --host 0.0.0.0 --port $PORT`。网页和 API 一起运行，无需跨域服务。

测试覆盖工厂示例、超产承担、装箱取整、非法输入、原 API 回归及 FastAPI/Worker 结果对比。跨环境测试需要 Node.js 22+，无 Node 时该部分跳过；CI 安装 Node 并执行完整测试。

## 原克重 API 使用说明

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
