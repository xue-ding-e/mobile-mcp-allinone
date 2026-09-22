# 安全说明

本文件适用于 xue-ding-e/mobile-mcp-allinone。

## 使用范围

本工具可以操作已连接的设备和应用。运行脚本或回放前，请核对目标设备、应用和步骤；设备测试也可能改变应用状态。

本地 MCP 配置、访问令牌、设备截图和调试日志不应提交到仓库。HTTP 模式需要认证时，设置 `MOBILEMCP_AUTH` 并在客户端使用相应的 Bearer token。

## 问题反馈

维护入口：[xue-ding-e/mobile-mcp-allinone](https://github.com/xue-ding-e/mobile-mcp-allinone)。

可公开的问题通过本仓库 Issues 提交，注明提交版本、复现步骤和经过脱敏的日志。涉及凭据或未公开漏洞时，先与仓库维护者确认私下提交渠道，不要在公开 Issue 中粘贴敏感信息。

安全修复以本仓库实际发布的提交为准，不承诺为所有历史版本提供维护。
