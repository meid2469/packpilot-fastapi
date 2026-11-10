# PackPilot 2.0 材料比重与计算默认值依据

核验日期：2026-11-06。比重输入单位为 g/cm³（与数值相同的 kg/L）。这些是报价估算预设，不是所有厂家、牌号、配方的保证值；实际采购膜应以供应商该批次 TDS / COA、实测克重或实投 kg 为准。全部允许手工修改。

| 材料/类型 | 建议预设 | 一手来源与支持信息 | 应显示的口径 |
| --- | ---: | --- | --- |
| PET / BOPET | 1.40 | [TOYOBO 工业薄膜资料](https://www.toyobo-global.com/products/ind_film/method/index.html) 第3表给 TOYOBOESTER 双向拉伸聚酯膜密度1.40；数据为典型值 | PET基膜估算值，按供应商资料修改 |
| PA / BOPA | 1.15 | [Biaxis BOPA 15E STD TDS](https://www.biaxis.com/uploads/tds-bopa-15e-std.pdf) 密度1.15±0.01（ISO1183）；[TOYOBO](https://www.toyobo-global.com/products/ind_film/method/index.html) ONY也列1.15 | 明确标“本单假设1.15；1.16可选参考，待厂家确认”。1.15~1.16不是所有PA产品范围，也不能对其他PA类型通用 |
| LDPE | 0.923 | [SABIC LDPE 官方产品页](https://www.sabic.com/en/products/polymers/polyethylene-pe/sabic-ldpe) HP4025ZN为通用吹膜级，密度923kg/m³；[SABIC 产品手册](https://www.sabic.com/en/Images/Polymers-All-Products_tcm1010-42650.pdf) HP4025ZN等列0.923 | 示例树脂牌号值。成膜含共混、填料时应按厂家膜资料 |
| LLDPE / mLLDPE | 0.918 | [Shell Polymers 18F5M](https://www.shell.us/business/sectors/shell-polymers/product-selector/18f5m.html) 是乙烯-己烯茂金属流延膜树脂，密度0.918；[ExxonMobil LLDPE PDS索引](https://www.exxonmobilchemical.com/en/resources/product-data-sheets/polyethylene/exxonmobil-ntx-lldpe) C4LL2018.XBU也列0.918 | 示例牌号值，不代表所有LLDPE配方 |
| HDPE（低压PE） | 0.952 | [SABIC HDPE 官方产品页](https://www.sabic.com/en/products/polymers/polyethylene-pe/sabic-hdpe) F00952 / 7000F为吹膜级，密度952kg/m³ | 低压PE通常指HDPE。不能把0.90作为HDPE或所有PE的通用密度 |
| PE（历史订单/工厂假设） | 0.930 | 用户历史 PA15/PE75 算例指定，未收到该PE牌号TDS | 必须标“历史单假设0.93，非通用物性，待供应商确认”；不可和LDPE/LLDPE/HDPE有出处预设混同 |
| RCPP（蒸煮流延PP） | 0.91 | [Sinofilm RCPP TDS](https://www.sino-film.com/pdf/RCPP.pdf) CPP film (retort grade) 45~80μm，密度0.91，ASTM D1505 | 厂家典型值，可按实际牌号修改 |
| VMPET | 1.40 | [Toray Claryl M/M-O 镀铝PET TDS](https://www.torayfilms.eu/wp-content/uploads/2019/12/Claryl%C2%AE-M-M-O.pdf) 明确金属层/PET结构；12μm列克重16.8g/m²（16.8÷12=1.40）；PET基膜参考TOYOBO | 默认按PET基膜估算，未单独计镀铝层质量。若厂家给实际总克重/实投kg，优先使用，不应当成铝箔(AL) |

## 建议界面短文案

- 比重（g/cm³），每层独立可编辑。
- PA：本单假设1.15，1.16可选参考，需厂家确认。
- PE：先选类型/牌号；历史示例0.93仅为订单假设。
- VMPET：按PET基膜1.40估算；镀铝质量未单计，实际kg可覆盖。
- 供应商实际kg覆盖时，不再对覆盖值乘1.02。

## 计算换算检查

理论原膜kg = 宽mm × 6000m × 厚mm × 比重 / 1000。

界面厚度若使用 μm，厚度mm = μm / 1000，因此等价式是 宽mm × 6000m × 厚μm × 比重 / 1000000。

内膜宽度为其外/中层宽度+5mm，这是宽度差，不是厚度+5mm。
