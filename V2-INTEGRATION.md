# 正浩包装 / PackPilot 复合袋报价 2.0 接入

本次已恢复完整2.0及规格库工程，并补齐成品单袋克重与印刷。代码提交到GitHub不等于线上更新；本次通过分支/PR交付，没有执行生产发布。

本工程以 GitHub `meid2469/packpilot-fastapi` 的 `main` 快照 `1be54e27b199b0a150709fa367c03f148bfdccee` 为基础增量接入。

## 打开网页

安装 Python 3.10+ 后，在本目录执行：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-verified.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Windows PowerShell 使用 `.venv\Scripts\Activate.ps1` 激活。

- `http://127.0.0.1:8000/v2/`：复合袋报价 2.0。
- `http://127.0.0.1:8000/`：原 PE 吹膜袋 V1。
- `http://127.0.0.1:8000/docs`：原 API 文档。

`static/v2/` 是独立前端，可直接作为静态网站部署；建议通过 HTTP 打开，浏览器本地文件策略可能限制部分功能。它在浏览器内计算，报价数据不会提交到 V1 的单材质接口。V2 的完整计算公式、假设和来源在网页中显示。

`requirements.txt` 保留了上游锁定版本；`requirements-verified.txt` 记录本次实际执行回归测试的环境版本，便于复现。

## 原接口兼容

以下接口及计算规则保持：

| 接口 | 用途 |
| --- | --- |
| `GET /health` | 原健康检查，响应版本仍为 `1.0.0` |
| `POST /calculate-cost` | 原 PE 吹膜成本模型 `zhenghao-pe-v1.0` |
| `POST /calculate-weight` | 原双面单材质克重计算 |

2.0 没有重用或覆盖上述算法，也没有声称原接口支持复合袋。不新增重复的服务器计算引擎。

## 部署

### FastAPI / Render / 容器

现有 `Dockerfile` 和 `render.yaml` 可继续使用，入口为 `app:app`。若需精确复现本次测试环境，将安装依赖文件改为 `requirements-verified.txt`。云服务器设置 `--host 0.0.0.0 --port $PORT`，网页和 API 同源。V2 访问地址为部署域名后加 `/v2/`。

### 纯静态网站

把 `static/v2/` 的全部内容上传到静态托管目录，首页为 `index.html`。所有引用均应保留目录关系。纯静态版本只提供 V2 浏览器计算，原 V1 API 仍由 FastAPI 或原 Worker 提供。

### Sites Worker

使用保留的 `.openai/hosting.json` 站点身份，勿创建新的 project_id。安装 Python 依赖及 Node.js 22+ 后运行：

```bash
PACKPILOT_PYTHON=.venv/bin/python node scripts/build-worker.mjs
```

构建脚本将 V1 首页、原 API 兼容层、V2 前端与参考图片一并写入 `dist/server/index.js`。`/v2/` 与 `/v2` 均可访问；发布由 Sites 工作流完成。云端不启动 Python，V2 仍使用与本地相同的浏览器计算模块。

## 验证

```bash
python -m pytest -q
```

测试保留上游 API、Decimal 舍入和 Python/Worker 对比检查；Node.js 不可用时会明确跳过 Worker 对比。可用 `NODE_BINARY` 指定 Node 路径。V2 集成检查在已复制 `static/v2/` 后执行。


## 规格库更新

新增的规格库使用同一站点、同一计算引擎。Sites Worker 的 `/api/specs` 使用 D1 数据库，绑定为 `DB`；发布包包含 `drizzle/0000_spec_library.sql` 及迁移记录，Sites 发布时应用迁移。首次访问事务性写入原有两条历史规格，标记初始化完成；用户删除后不会重新生成。数据库仅存完整输入，加载后通过原引擎重新计算，不存固定报价结果。

独立文件、`launch.py` 或现有 FastAPI 没有规格 API 时使用浏览器 localStorage，页面明确说明设备、浏览器及网址限制。线上数据库出现错误时不会自动切换成本地库，不会将内存状态声称为保存成功。

规格接口与原 V1 接口分开，Worker 的 POST/PUT/DELETE 要求同源 Origin 及 JSON。更新、删除带 revision 保护多页并发编辑。保持现有私有访问权限；共享权限若未来变化，数据库将供该站点允许访问的人员共同使用，需另行设计账号隔离。

测试（Node.js 24+，其中 API 测试使用 node:sqlite）：

```bash
node --test tests/engine.test.cjs tests/spec-library.test.cjs tests/specs-api.test.mjs
python3 -m pytest -q
```

完整使用和存储说明见 `SPEC-LIBRARY.md`。

## 成品克重与印刷

成品克重使用产品实际展开面积，与6000m投料kg分别核算。三边封按宽×长×2，中封宽度已含完整展开和搭接，不重复乘2。自立/异形等需填写完整展开面积，否则仅显示成本，克重标为待确认。单层克重g = 面积㎡×厚度μm×比重；胶水按1.5g/㎡×复合道数估算留存量，实际干胶量应按工厂数据核实。2%仅用于原膜投料，不增加成品理论克重。PA15/PE75、110×180mm示例含胶3.5046g。

印刷模式：无印刷0元；按面积默认0.50元/㎡（可修改）；阶梯来自工程附带的《销售价格核定方案》上页。6色及以下、批次≥5轴200元/轴，否则300元/轴；7色及以上、批次>3轴300元/轴，否则500元/轴。批次轴数只选择费率，本结果仍为一轴成本。阶梯允许主管按元/轴覆盖。原表标注2020-11-01起使用，当前适用性须由工厂确认；没有擅加销售利润。

总成本 = 原膜 + 印刷 + 复合 + 制袋 + 包装。新增输入连同规格完整保存。Node测试含历史数据兼容、工厂阶梯边界和持久保存。
