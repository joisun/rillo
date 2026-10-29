# 状态

status: done
current_task: complete
branch: feature/rillo-rename
worktree: /Users/joi-com/Desktop/space/projects/rillo/.worktree/feature-rillo-rename

T1 源码、文档与协议标识更名，T2 安装迁移，T3 隔离验证，T4 本机服务/插件/数据迁移，T5 目录修复、残留扫描和验收均完成。验证结果见 06-test-report.md。

本机运行 Rillo 0.15.0：rillo CLI、com.joi.rillo.daemon、rillo@rillo Codex/Claude 插件。本地构建安装，未公开发布。旧服务已卸载，数据整体移动到新路径，历史版本内容不改写。

原233条Run逐行哈希不变，准备期间正常新增1条成功记录，总234；其余数据库表一致。7个Schedule/2 enabled、187份原Markdown保持一致。备份位置见迁移报告。

根目录已为 /Users/joi-com/Desktop/space/projects/rillo。34个worktree已repair，其他worktree原始status/diff完全一致。旧根目录仅为过渡软链接，维持历史cwd和并行开发入口。

用户补充授权后GitHub仓库已更名joisun/rillo，origin已更新；仓库ID、4个分支SHA、28个Release及资产元数据不变。未推送本次源码、未发布、未操作sun。

按既有本地提交范围整合更名到主checkout；独立重试提交6a239d3保留。dotfiles相关配置已更新，但具有其他既存改动，未混入项目提交。后续公开发布需另行明确执行。
