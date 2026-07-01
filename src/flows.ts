// run_flow —— 重放/积木:把一段 JSON 步骤序列(原生 + webview 混合)按序回放。
// 步骤 = {op, ...params}。原生 op 走 Robot,webview op 走 WebviewManager,另有控制/断言 op。
// 具名 flow 存盘(<repo>/flows/*.json),下次直接按名调用。
// 元素级 tap_text:按 text/resource-id/label 定位再点中心(不写死坐标,换分辨率不偏)。
import fs from "node:fs";
import path from "node:path";
import { Robot } from "./robot";
import { WebviewManager } from "./webview";

export interface FlowStep {
	op: string;
	device?: string;
	note?: string;
	// 通用参数(按 op 取用)
	packageName?: string;
	x?: number;
	y?: number;
	text?: string;
	button?: string;
	direction?: "up" | "down" | "left" | "right";
	distance?: number;
	submit?: boolean;
	ms?: number;
	saveTo?: string;
	selector?: string;
	props?: string[];
	expression?: string;
	equals?: string;
	contains?: string;
	port?: number;
}

export interface FlowContext {
	getRobot: (device: string) => Robot;
	webview: WebviewManager;
	defaultDevice?: string;
}

export interface StepResult {
	i: number;
	op: string;
	ok: boolean;
	info: string;
}

const FLOWS_DIR = process.env.MOBILEMCP_FLOWS_DIR || path.join(__dirname, "..", "flows");

const dev = (step: FlowStep, ctx: FlowContext): string => {
	const d = step.device || ctx.defaultDevice;
	if (!d) {
		throw new Error(`步骤 ${step.op} 缺 device(且无 defaultDevice)`);
	}
	return d;
};

// 执行单个步骤,返回人读 info(失败抛异常)
const runStep = async (step: FlowStep, ctx: FlowContext): Promise<string> => {
	const wv = ctx.webview;
	switch (step.op) {
		// ---- 原生 ----
		case "launch_app": {
			await ctx.getRobot(dev(step, ctx)).launchApp(step.packageName!);
			return `launched ${step.packageName}`;
		}
		case "terminate_app": {
			await ctx.getRobot(dev(step, ctx)).terminateApp(step.packageName!);
			return `terminated ${step.packageName}`;
		}
		case "tap": {
			await ctx.getRobot(dev(step, ctx)).tap(step.x!, step.y!);
			return `tapped ${step.x},${step.y}`;
		}
		case "tap_text": {
			// 元素级:按 text/resource-id/label 定位 → 点中心(不写死坐标)
			const robot = ctx.getRobot(dev(step, ctx));
			const els = await robot.getElementsOnScreen();
			const t = step.text!;
			const el = els.find(e => (e.text || "").trim() === t || e.identifier === t || (e.label || "") === t);
			if (!el) {
				throw new Error(`tap_text 未找到元素: ${t}`);
			}
			const cx = Math.round(el.rect.x + el.rect.width / 2);
			const cy = Math.round(el.rect.y + el.rect.height / 2);
			await robot.tap(cx, cy);
			return `tap_text '${t}' @${cx},${cy}`;
		}
		case "press_button": {
			// button 来自 JSON 字符串;AndroidRobot.pressButton 内部按 BUTTON_MAP 校验非法值会抛
			await ctx.getRobot(dev(step, ctx)).pressButton(step.button! as any);
			return `pressed ${step.button}`;
		}
		case "swipe": {
			const robot = ctx.getRobot(dev(step, ctx));
			if (step.x !== undefined && step.y !== undefined) {
				await robot.swipeFromCoordinate(step.x, step.y, step.direction!, step.distance);
			} else {
				await robot.swipe(step.direction!);
			}
			return `swiped ${step.direction}`;
		}
		case "type_keys": {
			const robot = ctx.getRobot(dev(step, ctx));
			await robot.sendKeys(step.text!);
			if (step.submit) {
				await robot.pressButton("ENTER");
			}
			return `typed '${step.text}'`;
		}
		case "screenshot": {
			const buf = await ctx.getRobot(dev(step, ctx)).getScreenshot();
			fs.writeFileSync(step.saveTo!, buf);
			return `screenshot -> ${step.saveTo} (${buf.length}B)`;
		}
		// ---- webview ----
		case "webview_connect": {
			const info = await wv.connect(dev(step, ctx), step.packageName!, step.port ?? 9222);
			return `webview connected: ${JSON.stringify(info)}`;
		}
		case "webview_evaluate": {
			const v = await wv.evaluate(dev(step, ctx), step.expression!);
			return `eval => ${typeof v === "string" ? v : JSON.stringify(v)}`;
		}
		case "webview_computed_style": {
			const r = await wv.computedStyle(dev(step, ctx), step.selector!, step.props);
			return `style ${step.selector} => ${JSON.stringify(r)}`;
		}
		case "webview_click_text": {
			const r = await wv.clickText(dev(step, ctx), step.text!);
			if (r !== "clicked") {
				throw new Error(`webview_click_text 未点到: ${step.text}`);
			}
			return `webview clicked '${step.text}'`;
		}
		case "webview_disconnect": {
			wv.disconnect(dev(step, ctx));
			return "webview disconnected";
		}
		// ---- 控制 / 断言 ----
		case "wait": {
			await new Promise(r => setTimeout(r, step.ms ?? 1000));
			return `waited ${step.ms ?? 1000}ms`;
		}
		case "log": {
			return step.note || "";
		}
		case "assert_route": {
			const hash = await wv.evaluate(dev(step, ctx), "location.hash");
			const h = String(hash);
			if (step.equals !== undefined && h !== step.equals) {
				throw new Error(`断言路由失败: 期望 '${step.equals}' 实际 '${h}'`);
			}
			if (step.contains !== undefined && h.indexOf(step.contains) < 0) {
				throw new Error(`断言路由失败: '${h}' 不含 '${step.contains}'`);
			}
			return `route ok: ${h}`;
		}
		case "assert_eval": {
			const v = await wv.evaluate(dev(step, ctx), step.expression!);
			const s = typeof v === "string" ? v : JSON.stringify(v);
			if (step.equals !== undefined) {
				if (s !== step.equals) {
					throw new Error(`断言失败: 期望 '${step.equals}' 实际 '${s}'`);
				}
			} else if (!v) {
				throw new Error(`断言失败: 表达式为假 (${s})`);
			}
			return `assert ok: ${s}`;
		}
		default:
			throw new Error(`未知 op: ${step.op}`);
	}
};

export const runFlow = async (steps: FlowStep[], ctx: FlowContext, stopOnError = true): Promise<{ passed: boolean; results: StepResult[] }> => {
	const results: StepResult[] = [];
	let passed = true;
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		try {
			const info = await runStep(step, ctx);
			results.push({ i, op: step.op, ok: true, info: step.note ? `${step.note} | ${info}` : info });
		} catch (e: any) {
			passed = false;
			results.push({ i, op: step.op, ok: false, info: `ERR: ${e.message || e}` });
			if (stopOnError) {
				break;
			}
		}
	}
	return { passed, results };
};

// ---- 具名 flow 存盘 ----
export const saveFlow = (name: string, steps: FlowStep[]): string => {
	if (!fs.existsSync(FLOWS_DIR)) {
		fs.mkdirSync(FLOWS_DIR, { recursive: true });
	}
	const file = path.join(FLOWS_DIR, `${name}.json`);
	fs.writeFileSync(file, JSON.stringify(steps, null, 2));
	return file;
};

export const loadFlow = (name: string): FlowStep[] => {
	const file = path.join(FLOWS_DIR, `${name}.json`);
	if (!fs.existsSync(file)) {
		throw new Error(`flow 不存在: ${name}(${FLOWS_DIR})`);
	}
	return JSON.parse(fs.readFileSync(file, "utf8"));
};

export const listFlows = (): string[] => {
	if (!fs.existsSync(FLOWS_DIR)) {
		return [];
	}
	return fs.readdirSync(FLOWS_DIR).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, ""));
};
