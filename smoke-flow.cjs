// 不走 MCP,直接验证 run_flow 引擎:原生 + webview 混合步骤回放(连 MuMu book)
const { runFlow } = require("./lib/flows.js");
const { AndroidRobot } = require("./lib/android.js");
const { WebviewManager } = require("./lib/webview.js");

(async () => {
	const ctx = {
		getRobot: (d) => new AndroidRobot(d),
		webview: new WebviewManager(),
		defaultDevice: process.argv[2] || "127.0.0.1:5555",
	};
	const pkg = process.argv[3] || "cn.csxs.xiaoshuo";
	const steps = [
		{ op: "launch_app", packageName: pkg, note: "原生:启动 book" },
		{ op: "wait", ms: 3500 },
		{ op: "webview_connect", packageName: pkg, note: "webview:连接" },
		{ op: "assert_route", contains: "tabbar", note: "断言:路由含 tabbar" },
		{ op: "webview_evaluate", expression: "JSON.stringify({tab:document.querySelectorAll('.van-tabbar-item').length,hasApp:!!document.querySelector('#app')})", note: "webview:数 tabbar" },
		{ op: "webview_computed_style", selector: "#app", note: "webview:量 #app" },
		{ op: "webview_disconnect", note: "释放 socket" },
	];
	const r = await runFlow(steps, ctx, true);
	console.log("FLOW_RESULT:", JSON.stringify(r, null, 2));
	process.exit(r.passed ? 0 : 1);
})();
