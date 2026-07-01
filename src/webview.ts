// Webview (page-level CDP) engine —— 移植自已验证的 cdp.mjs。
// 直连安卓 in-app 系统 WebView 的 page 端点(/devtools/page/<id>),只发 page 级域命令
// (Runtime/DOM/CSS/Page/Network),不碰 Browser/Target —— 这是唯一能读到 Tauri/wry
// 系统 WebView 的方式(browser 级的 Playwright/Puppeteer/chrome-devtools-mcp 全失败)。
// 现代设备 + chrome68 老机型通吃。
import WebSocket from "ws";
import http from "node:http";
import path from "node:path";
import { existsSync, writeFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";

const getAdbPath = (): string => {
	const exe = process.platform === "win32" ? "adb.exe" : "adb";
	if (process.env.ANDROID_HOME) {
		return path.join(process.env.ANDROID_HOME, "platform-tools", exe);
	}
	if (process.platform === "win32" && process.env.LOCALAPPDATA) {
		const p = path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe");
		if (existsSync(p)) {
			return p;
		}
	}
	return exe;
};

const adb = (serial: string, args: string[], timeout = 20000): string => {
	try {
		return execFileSync(getAdbPath(), ["-s", serial, ...args], { timeout, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).toString();
	} catch (e: any) {
		return ((e.stdout?.toString() || "") + (e.stderr?.toString() || "")).trim();
	}
};

export interface WebviewPage {
	type: string;
	url: string;
	title: string;
	webSocketDebuggerUrl: string;
}

// GET http://127.0.0.1:<port>/json/list -> 只取 type:page
export const listPages = (port = 9222): Promise<WebviewPage[]> =>
	new Promise((resolve, reject) => {
		const req = http.get({ host: "127.0.0.1", port, path: "/json/list", timeout: 5000 }, res => {
			let s = "";
			res.on("data", d => (s += d));
			res.on("end", () => {
				try {
					resolve(JSON.parse(s));
				} catch {
					reject(new Error("解析 /json/list 失败: " + s.slice(0, 120)));
				}
			});
		});
		req.on("error", reject);
		req.on("timeout", () => { req.destroy(); reject(new Error(`连 127.0.0.1:${port} 超时,先 adb forward`)); });
	});

// 找目标 app webview pid 并 adb forward tcp:<port> -> localabstract:webview_devtools_remote_<pid>
export const autoForward = (serial: string, pkg: string, port = 9222): { pid: string; sock: string } => {
	const pid = adb(serial, ["shell", "pidof", pkg]).trim().split(/\s+/)[0];
	if (!pid) {
		throw new Error(`${pkg} 未在 ${serial} 运行(pidof 空),先启动 App`);
	}
	const unix = adb(serial, ["shell", "cat", "/proc/net/unix"]);
	const sock = `webview_devtools_remote_${pid}`;
	if (!unix.includes(sock)) {
		throw new Error(`未发现 ${sock} socket(webview 未就绪或非 debug 包)`);
	}
	adb(serial, ["forward", `tcp:${port}`, `localabstract:${sock}`]);
	return { pid, sock };
};

// 极简 raw-ws CDP 客户端(只连 page 端点、只发扁平 {id,method,params})
export class Cdp {
	private ws: WebSocket | null = null;
	private id = 0;
	private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
	private listeners = new Map<string, Set<(p: any) => void>>();

	constructor(private wsUrl: string) {}

	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.ws = new WebSocket(this.wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
			this.ws.once("open", () => resolve());
			this.ws.once("error", reject);
			this.ws.on("message", (buf: WebSocket.RawData) => {
				let msg: any;
				try { msg = JSON.parse(buf.toString()); } catch { return; }
				if (msg.id != null && this.pending.has(msg.id)) {
					const p = this.pending.get(msg.id)!;
					this.pending.delete(msg.id);
					msg.error ? p.reject(new Error(msg.error.message || JSON.stringify(msg.error))) : p.resolve(msg.result);
				} else if (msg.method) {
					this.listeners.get(msg.method)?.forEach(cb => { try { cb(msg.params); } catch { /* ignore */ } });
				}
			});
		});
	}

	send(method: string, params: any = {}): Promise<any> {
		return new Promise((resolve, reject) => {
			const id = ++this.id;
			this.pending.set(id, { resolve, reject });
			this.ws!.send(JSON.stringify({ id, method, params }));
			setTimeout(() => {
				if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP ${method} 超时`)); }
			}, 30000);
		});
	}

	on(method: string, cb: (p: any) => void): void {
		if (!this.listeners.has(method)) {
			this.listeners.set(method, new Set());
		}
		this.listeners.get(method)!.add(cb);
	}

	get alive(): boolean {
		return !!this.ws && this.ws.readyState === WebSocket.OPEN;
	}

	close(): void {
		try { this.ws?.close(); } catch { /* ignore */ }
		this.ws = null;
	}
}

const DEFAULT_CSS_PROPS = ["display", "position", "width", "height", "font-size", "color", "background-color", "flex", "overflow", "transform"];

// 每设备一个 webview CDP 会话(同一 webview 同时只允许一个 CDP 连接)。
export class WebviewManager {
	private sessions = new Map<string, { cdp: Cdp; port: number }>();

	// 连接/重连目标 app 的 webview(自动 adb forward;App 重启 pid 变会重连)
	async connect(serial: string, pkg: string, port = 9222): Promise<{ url: string; title: string; hash: string; hasApp: boolean }> {
		this.disconnect(serial);
		autoForward(serial, pkg, port);
		const pages = await listPages(port);
		const page = pages.find(p => p.type === "page") || pages[0];
		if (!page?.webSocketDebuggerUrl) {
			throw new Error("无可连的 page 目标(检查 App 是否在前台)");
		}
		const cdp = new Cdp(page.webSocketDebuggerUrl);
		await cdp.connect();
		await cdp.send("Runtime.enable").catch(() => {});
		await cdp.send("Page.enable").catch(() => {});
		this.sessions.set(serial, { cdp, port });
		const info = await this.evaluate(serial, "JSON.stringify({url:location.href,title:document.title,hash:location.hash,hasApp:!!document.querySelector('#app')})");
		return JSON.parse(info);
	}

	private cdp(serial: string): Cdp {
		const s = this.sessions.get(serial);
		if (!s || !s.cdp.alive) {
			throw new Error(`设备 ${serial} 的 webview 未连接,先调 webview_connect`);
		}
		return s.cdp;
	}

	// 在 webview 执行 JS 返回 JSON 值(⚠ chrome68 注入 JS 禁 ?./??,用 a&&a.b)
	async evaluate(serial: string, expression: string): Promise<any> {
		const r = await this.cdp(serial).send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		if (r.exceptionDetails) {
			const ex = r.exceptionDetails.exception;
			throw new Error((ex && (ex.description || ex.value)) || r.exceptionDetails.text || "JS 异常");
		}
		return r.result ? r.result.value : undefined;
	}

	async computedStyle(serial: string, selector: string, props?: string[]): Promise<any> {
		const ps = JSON.stringify(props || DEFAULT_CSS_PROPS);
		const exp = "(function(){var e=document.querySelector(" + JSON.stringify(selector) + ");if(!e)return null;"
			+ "var s=getComputedStyle(e);var ps=" + ps + ";var o={};for(var i=0;i<ps.length;i++){o[ps[i]]=s.getPropertyValue(ps[i]);}"
			+ "var r=e.getBoundingClientRect();o._rect={x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};"
			+ "return JSON.stringify(o);})()";
		const v = await this.evaluate(serial, exp);
		return v == null ? null : JSON.parse(v);
	}

	async domOutline(serial: string, selector = "body", maxChars = 4000): Promise<string> {
		const exp = "(function(){var e=document.querySelector(" + JSON.stringify(selector) + ");return e?e.outerHTML:'未命中';})()";
		return String(await this.evaluate(serial, exp)).slice(0, maxChars);
	}

	async clickText(serial: string, text: string): Promise<string> {
		const exp = "(function(){var T=" + JSON.stringify(text) + ";var a=document.querySelectorAll('button,.van-button,div,span,a,li');"
			+ "for(var i=0;i<a.length;i++){var e=a[i];if((e.textContent||'').trim()==T&&e.offsetParent!=null){e.click();return 'clicked';}}return 'notfound';})()";
		return await this.evaluate(serial, exp);
	}

	async screenshot(serial: string, savePath: string): Promise<{ saved: string; bytes: number }> {
		const r = await this.cdp(serial).send("Page.captureScreenshot", { format: "png" });
		writeFileSync(savePath, Buffer.from(r.data, "base64"));
		return { saved: savePath, bytes: statSync(savePath).size };
	}

	async networkCapture(serial: string, ms = 3000): Promise<any[]> {
		const cdp = this.cdp(serial);
		const reqs = new Map<string, any>();
		cdp.on("Network.requestWillBeSent", (p: any) => reqs.set(p.requestId, { url: p.request.url, method: p.request.method, type: p.type }));
		cdp.on("Network.responseReceived", (p: any) => { const e = reqs.get(p.requestId); if (e) { e.status = p.response.status; e.mime = p.response.mimeType; } });
		await cdp.send("Network.enable").catch(() => {});
		await new Promise(r => setTimeout(r, ms));
		return [...reqs.values()];
	}

	disconnect(serial: string): void {
		this.sessions.get(serial)?.cdp.close();
		this.sessions.delete(serial);
	}
}
