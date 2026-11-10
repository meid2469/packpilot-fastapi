# 价格核算2.0源码恢复核查（2026-11-11）

## 为什么GitHub看不到2.0

核查时 `meid2469/packpilot-fastapi` 是公开仓库，默认main，仅有该分支；没有任何PR。最近提交1be54e27b199b0a150709fa367c03f148bfdccee（2026-11-05北京时间00:31）是PE背心袋V1，前一条为f5da98f7d774446cc787938e0db45cb1f05c9bc2。该快照没有static/v2、规格库API或迁移文件。账号的其他仓库为Mei（空）及meid2469（空），没有发现另一个PackPilot GitHub仓库。

此前任务确实完成过代码开发，但进入独立Sites源码工作流，没有同步回用户的GitHub仓库。新对话移交本身不能证明开发、提交、推送或部署。

最新旧版源码本地提交7a1188c367b9a33ffa08505d3947bd8685bf62fa，工程目录：`/Users/meidongshuo/Documents/Codex/2026-11-06/referenced-chatgpt-conversation-this-is-an-2/work/site`，工作区干净且未配置GitHub远程地址。其历史为7a1188c → 5c6de91 → 754255d → 1be54e2。最新导出在同日另一对话`referenced-chatgpt-conversation-this-is-an-3/outputs/PackPilot-2.0-规格库更新`。

原Sites项目为appgprj_6aeb5c31fd448191a55ae52a54f7247c，源码提供方cloudflare_artifact，源码Git地址为`https://git.chatgpt-team.site/9253a9dd-fa02-45c7-915c-b7b892e73315/appgprj_6aeb5c31fd448191a55ae52a54f7247c.git`，与GitHub仓库分离。已实时查询其第3版源码为7a1188c，历史部署appgdep_6aedeb4659d88191b24934c76b929061状态succeeded。此证据仅说明旧版本发布记录，不代表本次修复已部署，也不等于本次完成线上交互测试。

## 本次恢复

以已核实GitHub主线1be54e2为基线恢复2.0、规格库、D1迁移和构建工具，补齐此前缺少的成品单袋克重与印刷费用。V1接口、算法及首页保留，首页增加2.0入口。成本不加利润、不在最后重复乘损耗。

本次变更通过`codex/restore-quotation-v2`分支和PR提交，合并前GitHub默认main仍显示旧版。未发布新版本到Sites或Render。运行/存储方式及公式见V2-INTEGRATION.md和SPEC-LIBRARY.md。

设备皮轴原照片保留在原私有站点，网页通过链接打开；因单次图片上传超出自动审批审阅容量，GitHub仅收录两张工厂费用模板和源码，不包含该大幅设备照片。
