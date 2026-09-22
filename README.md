# mobile-mcp-allinone

由 [xue-ding-e](https://github.com/xue-ding-e) 维护的移动设备自动化工具，提供 MCP 服务和 Android CLI，支持原生界面操作、WebView 调试及 JSON 流程重放。

项目地址：[xue-ding-e/mobile-mcp-allinone](https://github.com/xue-ding-e/mobile-mcp-allinone)。

## 功能

- 原生设备操作：查看设备、启动应用、读取界面元素、点击、输入、截图。
- Android WebView：通过页面级 CDP 读取 DOM、计算样式、执行 JavaScript 和查看网络请求。
- CLI 脚本：`run` / `eval` 注入设备、WebView 和流程接口，一次执行多个步骤。
- 流程重放：通过 JSON 步骤组合原生操作、WebView 操作和断言。
- MCP：为客户端提供 Android、iOS 真机及模拟器操作工具；iOS 需要相应的平台工具和 WebDriverAgent。

## 本地安装

准备 Node.js 22 或更高版本。Android 需要 ADB；iOS 需要对应的设备工具，模拟器需要 macOS / Xcode。

```powershell
git clone https://github.com/xue-ding-e/mobile-mcp-allinone.git
cd mobile-mcp-allinone
npm ci
npx tsc
```

以上命令从本仓库构建。本文不提供 npm 发布包安装方式。

## Android CLI

在仓库根目录运行：

```powershell
.\mobile.ps1 help
.\mobile.ps1 devices
.\mobile.ps1 use <设备序列号> --pkg <应用包名>
.\mobile.ps1 elements
.\mobile.ps1 eval "return await robot.getScreenSize()"
.\mobile.ps1 wv-outline
.\mobile.ps1 flow-list
```

WebView 操作要求目标应用开启 WebView 调试。使用 `node lib/cli.js` 也可调用相同命令。

个人回放、截图和现场脚本放在 `ignore/`，该目录不会提交。已归档的流程可通过完整路径执行；也可用 `MOBILEMCP_FLOWS_DIR` 指定本地流程目录。`flows/` 仅保留通用流程。

## MCP 配置

先完成构建，再将下面的路径替换为本机仓库绝对路径：

```json
{
  "mcpServers": {
    "mobile-mcp-allinone": {
      "command": "node",
      "args": ["D:/path/to/mobile-mcp-allinone/lib/index.js"],
      "env": {
        "MOBILEMCP_DISABLE_TELEMETRY": "1"
      }
    }
  }
}
```

默认使用 stdio。HTTP 模式可运行 `node lib/index.js --listen 3000`，端点为 `http://localhost:3000/mcp`；需要认证时设置 `MOBILEMCP_AUTH`，客户端发送对应的 Bearer token。

现有实现保留了上游 PostHog 使用统计逻辑。上述配置通过 `MOBILEMCP_DISABLE_TELEMETRY=1` 关闭统计，直接启动服务时也可设置该变量。

## 开发与反馈

- 检查：`npm run lint`、`npx tsc --noEmit`。
- 无设备测试：`npx playwright test test/png.ts`；其余设备测试可能操作真实设备。
- 问题反馈：[Issues](https://github.com/xue-ding-e/mobile-mcp-allinone/issues)。
- 安全说明：[SECURITY.md](SECURITY.md)。

## 许可与来源

本项目基于 Mobile Next 的 mobile-mcp 开发，保留 Apache-2.0 许可证和适用的原始版权声明，详见 [LICENSE](LICENSE)。`CHANGELOG.md` 中早于本分支的版本记录属于上游历史。Android DeviceKit、mobilewright 等依赖保留各自的名称和来源。
