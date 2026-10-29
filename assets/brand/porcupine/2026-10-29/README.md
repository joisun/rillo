# Rillo 吉祥物：刺刺

当前方向由用户指定为豪猪宝宝，项目名保持 **Rillo**。圆滚身体与短软刺表达亲近感，粉嫩的大鼻子和两只好奇的小眼睛是主要辨识特征。

- 正式原图：[rillo-baby-porcupine.png](rillo-baby-porcupine.png)，1254 × 1254 PNG。
- 配色：奶油白、可可梅紫、玫瑰粉鼻头，淡紫背景。
- 使用内置 `image_gen` 生成；模型版本未由工具提供。原图未重采样或后处理。
- 完整提示词与约束：[prompt.json](prompt.json)。

同一原图用于 `ui/assets/rillo.png`，构建时同步到两宿主 adapter 资产；导航、favicon、README 和 Codex 插件图标共用该素材。页面 URL 使用 `?v=porcupine-1`，避免继续显示前一版的缓存。

之前的 A2-v2 与其他候选保留在 `assets/brand/logo-candidates/2026-10-29`。本次没有修改项目名称、CLI、包名、插件标识、数据目录或 GitHub 仓库名，尚未公开发布。

本机验证：服务ready；导航和favicon加载新版URL成功，24px显示正常；React构建相关3个测试通过。7个定时任务及2个启用状态保持不变。原图已同步到本机服务及两宿主插件资产，原A2-v2备份保留。

提交前验收：恢复原测试文件，不提交测试改动；571个后端测试、82个UI测试、syntax/type/build全部通过，四种发布包包含同一原图，隔离新装的Dashboard、meta和SSE验证通过。favicon由页面入口创建，静态HTML继续满足既有构建约束。
