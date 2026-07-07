# magic-diary-ipad：iPad 魔法日记 Web/PWA 落地方案

> 目标：把 `MaximeRivest/riddle` 的“纸会读字、纸会回信”体验，重做成适合 iPad / Apple Pencil 使用的网页端 PWA。
>
> 重要边界：这不是 reMarkable 原项目移植；原项目的 Rust/C/C++ 硬件层不可复用。我们复用的是产品状态机与交互节奏。

---

## 1. 背景与问题

用户看到 `MaximeRivest/riddle` 项目后，希望把类似体验布置到网页端，用 iPad 使用。

原项目能力：

```text
reMarkable Paper Pro 上用笔写字
→ 停笔约 2.8 秒
→ 页面“吸收”墨迹
→ 将页面 PNG 发给视觉模型
→ AI 生成短回复
→ 回复以手写体逐笔写回纸面
→ 回复淡出
```

原项目强绑定：

- reMarkable Paper Pro；
- root 权限；
- raw evdev 笔输入；
- e-ink vendor engine；
- Rust/C/C++ 原生程序；
- `libqsgepaper.so` / AppLoad / xovi / takeover 模式。

这些不能直接部署到 iPad Web。

因此本项目的核心问题是：

> 如何在 iPad 浏览器/PWA 中，用 Web 技术重建“无聊天框、无键盘、纸面自己回应”的魔法日记体验？

---

## 2. 产品定位

### 一句话

一张会读你手写字、并用手写体回应你的 iPad 魔法纸。

### 不是

- 不是普通 ChatGPT 聊天框；
- 不是 GoodNotes 替代品；
- 不是专业白板；
- 不是 OCR 工具；
- 不是 reMarkable 原程序移植。

### 是

- 一个沉浸式手写 AI 交互界面；
- 一个 PWA 小应用；
- 一个“写字 → 墨迹消失 → 纸面回信”的仪式感体验。

---

## 3. 核心体验闭环

MVP 只验证一个闭环：

```text
用户用 Apple Pencil 写一句话
→ 停笔
→ 墨迹开始变淡，被纸吸收
→ 页面等待片刻
→ AI 回复以手写字浮现
→ 回复停留几秒
→ 回复淡出，页面恢复空白
```

MVP 成功标准：

- 用户不需要键盘；
- 页面没有聊天框；
- iPad 上 Apple Pencil 能正常书写；
- 停笔后自动触发；
- 模型能读懂大部分真实手写；
- 首字回复最好在 5 秒内出现；
- 回复短、像纸上浮现，不像客服回答。

---

## 4. 用户故事

1. 作为 iPad 用户，我想直接打开一个全屏纸面，所以我不需要面对聊天软件式界面。
2. 作为 Apple Pencil 用户，我想直接在纸面上写字，所以我可以像写日记一样与 AI 互动。
3. 作为用户，我想写完停笔后自动提交，所以我不用点击发送按钮。
4. 作为用户，我想看到墨迹被纸吸收，所以这个过程有魔法感而不是表单提交感。
5. 作为用户，我想 AI 能读懂我刚写的字，所以我不用再打一遍文字。
6. 作为用户，我想 AI 只回复 1–3 句，所以纸面不会变成大段聊天记录。
7. 作为用户，我想看到回复像手写一样出现，所以体验像纸在回信。
8. 作为用户，我想回复过一会儿自动淡出，所以页面始终保持日记纸的干净。
9. 作为用户，我想继续下笔能取消即将提交的墨迹，所以停顿思考时不会误触发。
10. 作为用户，我想在回复期间可以下笔打断，所以我不必等动画播完。
11. 作为用户，我想通过隐藏手势打开帮助，所以界面不用塞满按钮。
12. 作为用户，我想把网页添加到 iPad 主屏幕，所以它像一个独立 App。
13. 作为维护者，我想 API Key 只存在后端，所以前端代码泄露也不会导致模型 Key 被盗。
14. 作为维护者，我想限制请求频率和图片大小，所以模型额度不会被刷爆。
15. 作为重视隐私的用户，我想默认不保存手写图片和正文，所以我的日记内容不会留下不必要副本。

---

## 5. 功能范围

### P0：MVP 必须有

| 功能 | 描述 |
|---|---|
| 全屏纸面 | iPad 打开后是一张纸，无聊天 UI |
| Canvas 书写 | 支持 Apple Pencil / touch fallback |
| 压感笔迹 | 使用 `PointerEvent.pressure` 映射线宽 |
| 防浏览器手势 | 禁滚动、禁选区、禁默认触摸行为 |
| 停笔提交 | 默认 2.5–3 秒触发，可继续下笔取消 |
| 墨迹吸收 | 用户墨迹淡出/模糊/渗入纸面 |
| 裁剪导出 | 只导出墨迹 bounding box 附近区域 |
| 后端代理 | 前端不保存模型 API Key |
| 视觉模型 | 读取手写图像并生成短回复 |
| 手写回复 | MVP 可逐字/逐句显现，后续再做真实笔画 |
| 回复淡出 | 回复短暂停留后消失 |
| PWA | 支持添加到主屏幕 |

### P1：体验增强

| 功能 | 描述 |
|---|---|
| 流式回复 | 模型第一句回来就开始写 |
| `?` 帮助手势 | 画大问号打开帮助 |
| 双指撤销 | 撤销上一笔，替代硬件橡皮 |
| 下笔打断回复 | 用户重新书写时中断当前回复 |
| 多轮上下文 | 后端保留最近几轮，但前端不显示聊天记录 |
| 角色化错误 | 字迹不清时以日记语气追问 |

### P2：后续扩展

- 日记历史；
- Supabase / D1 / KV 存储；
- 多人格；
- Hermes 本地知识库接入；
- 中文手写字体优化；
- opentype.js / WASM 真实笔画路径；
- 原生 iPad wrapper；
- 分享导出。

---

## 6. 明确不做

MVP 不做：

- 登录账号；
- 云端历史；
- 多用户同步；
- 复杂工具栏；
- tldraw/Excalidraw 白板化；
- Rust/WASM 复刻原项目全部算法；
- reMarkable 设备兼容；
- OCR 文字显式展示；
- 长篇 AI 聊天。

---

## 7. 技术架构

推荐架构：

```text
iPad PWA
  ├─ Canvas 多层渲染
  ├─ Pointer Events / Apple Pencil
  ├─ idle commit 状态机
  ├─ 墨迹裁剪与导出
  ├─ 吸墨动画
  ├─ 手写回复动画
  ↓
Cloudflare Worker / 后端代理
  ├─ API Key Secret
  ├─ 访问控制
  ├─ 限流
  ├─ 图片大小限制
  ├─ 调用 OpenAI-compatible Vision Model
  ├─ 返回短回复或流式 chunk
  ↓
Vision LLM Provider
```

### 技术选择

| 层 | 推荐 |
|---|---|
| 前端 | Vite + React + TypeScript |
| 画布 | 原生 Canvas 2D，多层 canvas |
| 输入 | Pointer Events |
| PWA | vite-plugin-pwa 或手写 manifest/service worker |
| 后端 | Cloudflare Worker |
| 部署 | Cloudflare Pages + Worker |
| 模型 | OpenAI-compatible vision model |
| 存储 | MVP 不存；后续再选 KV/D1/Supabase |

---

## 8. 前端设计

### Canvas 分层

```text
paper-bg      静态纸张背景
user-ink      用户书写墨迹
effects       吸墨、墨点、呼吸动画
reply-ink     AI 回复手写动画
```

这样做的好处：

- 用户笔迹和回复分离；
- 吸墨只处理局部区域；
- 回复淡出不影响纸面背景；
- 后续动画更容易扩展。

### 状态机

```ts
type DiaryState =
  | { type: 'listening'; lastPenAt?: number }
  | { type: 'drinking'; region: BBox }
  | { type: 'thinking' }
  | { type: 'replying' }
  | { type: 'lingering' }
  | { type: 'fadingReply' }
  | { type: 'help' };
```

状态流：

```text
listening
→ drinking
→ thinking
→ replying
→ lingering
→ fadingReply
→ listening
```

### Pointer Events

关键点：

- `pointerdown` 开始 stroke；
- `pointermove` 记录轨迹；
- `pointerup` 结束 stroke；
- `pointercancel` 安全收尾；
- `setPointerCapture(pointerId)`；
- `getCoalescedEvents()` 提升平滑度；
- `pressure || 0.5` 兜底；
- `devicePixelRatio` 适配 Retina。

### iPad CSS 基线

```css
html,
body {
  margin: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  overscroll-behavior: none;
}

canvas {
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
```

---

## 9. 图片导出策略

不要上传全屏 Retina 截图。

流程：

```text
stroke 数据
→ 计算 bbox
→ 四周 padding 20–40px
→ 离屏 Canvas 白底黑字重绘
→ 降采样到长边 800–1200px
→ PNG/WebP Blob
→ POST /api/oracle
```

原因：

- 降低成本；
- 降低延迟；
- 提高手写识别稳定性；
- 避免把无关纸面区域发给模型。

---

## 10. 后端 API 设计

### MVP API

```http
POST /api/oracle
Content-Type: multipart/form-data
```

字段：

| 字段 | 类型 | 描述 |
|---|---|---|
| `image` | file | 裁剪后的手写图像 |
| `sessionId` | string | 本地生成的会话 ID |
| `locale` | string | 语言偏好，可选 |

响应 MVP：

```json
{
  "reply": "你的墨迹刚刚告诉我，你还没有真正决定。"
}
```

P1 可升级为 streaming：

```jsonl
{"type":"chunk","text":"你的墨迹刚刚告诉我，"}
{"type":"chunk","text":"你还没有真正决定。"}
{"type":"done"}
```

### 后端职责

- 读取 Secret API Key；
- 校验访问权限；
- 限制请求体大小；
- 限流；
- 超时；
- 调视觉模型；
- 将错误转成角色化但安全的前端响应；
- 日志脱敏。

---

## 11. 模型调用策略

### System Prompt 草案

```text
你是一本会读墨迹的旧日记。
用户用笔把话写在纸上，你只能通过图像看见这些墨迹。
请读取用户写下的内容，并用用户使用的语言回应。
回复必须短：1 到 3 句。
语气亲近、安静、像纸页上自己浮现的字。
不要提到 AI、模型、OCR、图片、识别、上传。
如果字迹不清，就说墨迹有些模糊，并用自然方式追问。
```

### 模型要求

- vision-capable；
- 支持图片输入；
- 支持短回复；
- 可选 streaming；
- 成本可控。

### 初始候选

- OpenAI vision model；
- OpenRouter 上的 vision-capable model；
- Gemini OpenAI-compatible endpoint。

MVP 不建议使用 reasoning model，除非识别质量明显更好。

---

## 12. 安全与隐私

### 硬规则

- 模型 API Key 绝不放前端；
- 前端不出现 `NEXT_PUBLIC_*` 类模型 key；
- 不把图片 base64 写进日志；
- MVP 默认不保存手写图片和正文；
- 不开放匿名公网无限访问。

### 访问控制

个人使用推荐：

- Cloudflare Access；
- 只允许本人邮箱 / One-Time PIN；
- 或简单访问口令 + HttpOnly session cookie。

### 限流建议

- 每分钟 5 次；
- 每小时 50 次；
- 每日预算上限；
- 图片大小 1–2MB 上限；
- 单请求超时 20–30 秒；
- 模型输出上限 300–800 tokens。

### 日志允许记录

- request_id；
- timestamp；
- user hash；
- image size；
- resized dimensions；
- model；
- latency；
- status code；
- token usage；
- estimated cost；
- error type。

### 日志禁止记录

- 图片 base64；
- OCR 转写；
- 完整 prompt；
- 完整模型回复；
- 用户日记正文。

---

## 13. 交互细节

### 首次进入

显示极轻提示：

> 写一句话，然后停笔。

提示几秒后淡出。

### 停笔提交

- 用户停笔 2.8 秒；
- 先进入“即将吸收”状态，墨迹轻微呼吸；
- 用户继续写则取消；
- 用户继续停笔则正式吸收。

### 回复期间

MVP 推荐：

- 回复出现时用户仍可下笔；
- 下笔会打断当前回复并淡出；
- 新墨迹进入 listening。

### 帮助

保留原项目趣味：

- 用户画一个大 `?`；
- 页面出现帮助卡；
- 再次下笔或停留后消失。

帮助内容：

```text
写完后停笔。
墨迹会被日记读走。
双指点按撤销。
长按角落清空。
添加到主屏幕体验最好。
```

---

## 14. 里程碑

### M0：技术验证，1–2 天

目标：证明闭环可行。

交付：

- 全屏 Canvas；
- Apple Pencil 书写；
- 停笔 2.8 秒；
- 裁剪 PNG；
- 后端调用模型；
- 返回纯文本。

验收：

- iPad Safari 可写；
- 模型能读懂真实手写；
- 延迟可接受。

### M1：PWA MVP，3–5 天

目标：可演示。

交付：

- PWA；
- 纸面背景；
- 多层 Canvas；
- 墨迹吸收；
- Cloudflare Worker；
- 模型短回复；
- 手写体逐字显示；
- 回复淡出。

验收：

- 无聊天 UI；
- 无键盘；
- 停笔自动响应；
- 首字回复 < 5 秒为佳；
- 添加到主屏幕可用。

### M2：体验增强，约 1 周

目标：更像“纸有灵魂”。

交付：

- 流式回复；
- 墨点呼吸；
- `?` 帮助；
- 双指撤销；
- 下笔打断；
- 延迟指标；
- 中文字体优化。

### M3：工程化，约 1 周

目标：可长期自己用。

交付：

- Cloudflare Access；
- 限流；
- 日志脱敏；
- 预算保护；
- provider fallback；
- prompt 配置；
- iPad 安装说明。

---

## 15. 测试方案

### 必须实机测试

桌面浏览器不能替代 iPad。

重点测试：

1. Apple Pencil 落笔延迟；
2. 停笔 2.8 秒是否误触发；
3. Safari/PWA 是否滚动、缩放、选中文本；
4. `pressure` 是否稳定；
5. `getCoalescedEvents()` 是否可用；
6. 模型是否读懂中文手写；
7. 首字回复耗时；
8. 网络慢时是否有可接受反馈；
9. 下笔打断是否自然；
10. 图片是否被正确裁剪。

### 自动测试

MVP 可少量做：

- 状态机单元测试；
- bbox 计算测试；
- 图片尺寸限制测试；
- API 请求大小限制测试；
- prompt 构造不泄露 debug 信息测试。

不要为动画细节写过度脆弱的快照测试。

---

## 16. 风险清单

| 风险 | 等级 | 应对 |
|---|---:|---|
| iPad Web 笔迹延迟不够好 | 中 | 实机优先验证；MVP 强调魔法反馈而非专业书写 |
| 模型读不懂手写 | 高 | 纯白背景、bbox 裁剪、图片降采样、失败追问 |
| API Key 泄露 | 高 | 只放后端 Secret |
| 成本被刷 | 高 | Access + 限流 + 图片大小限制 + token 限制 |
| Safari streaming 不稳定 | 中 | MVP 可先非流式，P1 再做 fetch stream |
| 中文手写回复字体不好看 | 中 | MVP 逐字显示；后续找合适中文手写字体 |
| 功能膨胀 | 高 | 严守 P0，只做闭环 |

---

## 17. 建议项目结构

```text
magic-diary-ipad/
  PRD_AND_TECH_PLAN.md
  app/
    package.json
    index.html
    src/
      main.tsx
      DiaryPage.tsx
      engine/
        canvasSurface.ts
        pointerInput.ts
        inkStore.ts
        idleCommit.ts
        exportInkImage.ts
        replyAnimator.ts
        diaryStateMachine.ts
      api/
        diaryClient.ts
      styles/
        paper.css
  worker/
    package.json
    src/
      index.ts
    wrangler.toml
```

---

## 18. 下一步

建议下一步直接做 M0 原型：

1. 建 Vite 前端；
2. 做全屏 Canvas；
3. 支持 Apple Pencil / touch 写字；
4. 停笔 2.8 秒后裁剪导出；
5. 先 mock 后端回复；
6. 本地浏览器验证；
7. 再让 iPad 访问局域网地址实机试写；
8. 最后接 Worker 和模型。

第一阶段不追求漂亮，只回答一个问题：

> iPad 上写一句话，纸能不能读懂并回一句？

如果这个闭环成立，再做吸墨和手写动画。