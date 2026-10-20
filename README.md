# Echo Tutor · 英语数字人老师

一个本地运行的英语学习应用：和 2D 数字人老师 Aria 进行实时语音对话，覆盖雅思 / 托福 / 考研英语的听说写训练。所有学习数据保存在本机 SQLite。

## 功能

- **口语对话**：自由对话、雅思 Part 1/2/3、托福口语、情景角色扮演、听力听写、影子跟读。
- **考试模拟**：题卡、准备计时、作答计时、Part 2 长独白不打断。
- **写作实验室**：80 道原创题（雅思 Task 1/2、托福 2026 Build a Sentence / Email / Academic Discussion、考研英语一/二），限时写作、rubric 评分、逐句纠错、历史记录。
- **间隔复习**：对话与作文中的错误自动生成卡片，按 FSRS 调度；支持手动添加词汇/短语。
- **学习报告**：连续天数、练习时长、开口词数、分数趋势、错误类型分布、近期纠错，历史会话报告可回看。
- **听力听写**：逐句播放、逐词输入、自动对齐，标出漏听和拼错的词。
- **数字人**：参数化 2D 骨骼，口型、眨眼、头部姿态、呼吸和倾听状态全部实时驱动。
- **离线可用**：不配置模型时，界面、题库、计时、朗读、写作本地粗估仍可工作。

## 快速开始

环境：Bun ≥ 1.1（项目在 Bun 1.4 / Node 22 上验证）。

```bash
bun install
bun run dev
```

打开 http://localhost:5173 。生产模式：

```bash
bun run build
bun run start
```

打开 http://127.0.0.1:8787 。服务默认只绑定 `127.0.0.1`。

### 配置模型

进入 **设置**，填写任意 OpenAI 兼容接口：

| 服务 | Base URL | 模型示例 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| Ollama | `http://localhost:11434/v1` | `qwen2.5:7b`（Key 填任意非空值） |

也可以用环境变量初始化：`LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY`。界面里的配置优先于环境变量（Key 存在本机数据库）。

未配置模型时：

- 对话会提示配置，不会伪造老师回复。
- 写作仍会给出基于字数、词汇多样性、连接词、确定性语法规则的**本地粗估**，并明确标注“置信度低”。

### 语音

#### 服务端 TTS 配置

1. 设置 → 语音 → 语音合成 → **服务端 TTS**。
2. 填 **TTS Base URL**、**TTS 模型**、**TTS API Key**。这三项可以留空，留空时复用上方的模型配置。
3. 只支持 OpenAI 兼容的 `POST /audio/speech`：
   - Base URL 例：`https://api.openai.com/v1`
   - 模型：`gpt-4o-mini-tts`（推荐）、`tts-1`、`tts-1-hd`
   - 语音：`fable`（通常为英式）、`alloy`、`echo`、`onyx`、`nova`、`shimmer`
4. DeepSeek / Moonshot / Ollama 通常只有聊天接口，没有 `/audio/speech`。这种情况请单独填一个支持 TTS 的服务，不要复用聊天地址。
5. 点“试听当前声音”验证。404 表示服务没有音频接口；401 表示 Key 不对；400 多为模型名或语音名不支持。

- **识别**：默认使用浏览器 Web Speech API，需要 Chrome / Edge，并且浏览器会联网。Firefox / Safari 请用文字输入，或在设置中切换到 Whisper（需要模型 Key）。
- **朗读**：默认浏览器 TTS；也可以切换到服务端 TTS（OpenAI 兼容 `/audio/speech`）。
- **发音人选择**：设置里可以直接选择系统里的英文语音，并试听；雅思模式优先选择英音（`en-GB`）的自然语音。练习面板提供“雅思听力音色”预设（Sonia/Ryan Natural，1.1x，比 IELTS 听力略快）。面板会显示**实际使用的发音人**，如果只找到美音或没有语音，会明确警告，而不是静默使用错误口音。
- **服务端语音**：选择 `fable` 通常是英式口音；还可以加 examiner 语气指令（清晰、中性、不夸张）。OpenAI 兼容服务若拒绝 `instructions` 字段，会自动重试。配置了模型 Key 时，练习面板可直接点“改用服务端英音”。
- **浏览器语音质量**：取决于操作系统。Edge 的 “Microsoft … Natural” 语音通常最接近真人；Linux 上的 Chrome 可能只有机械音或没有语音，这时请改用服务端 TTS。
- **建议戴耳机**。“允许打断”默认关闭；打开后说话会中断老师朗读，但麦克风可能拾取外放声音，导致误触发。
- 语音识别结果没有标点，报告会忽略由此产生的标点问题。

## 每天怎么用

1. **5 分钟**：间隔复习到期卡片。
2. **12 分钟**：选一个口语模式，和 Aria 对话；结束后看报告。
3. **8 分钟**：写作实验室写一段或一篇，提交批改。
4. **5 分钟**：把报告里的错误过一遍，错误会自动进入复习队列。

报告里的 band 是练习估算，不是正式考试成绩。口语评分只基于转写文本，**不能评估发音**，因此不包含发音维度；只有接入声学评测（如 Azure Pronunciation Assessment）后才应显示发音分。

## 技术架构

```
浏览器 (React + Vite)
  ├─ 2D 数字人（SVG 参数化骨骼）
  ├─ Web Speech API（ASR / TTS）
  └─ SSE 流式对话
        │
Bun HTTP 服务 (server/index.ts)
  ├─ OpenAI 兼容客户端（流式 + JSON 评分）
  ├─ 评分引擎（rubric / 指标 / 证据）
  ├─ FSRS 调度
  └─ SQLite（data/echo.db）
```

目录：

```
content/            题库、rubric、场景、跟读、短语
server/             Bun API、LLM、评分、FSRS、数据层
src/components/     对话、写作、复习、报告、设置、数字人
src/lib/            语音、文本对比、格式化
tests/              单元测试与测试用模型 stub
scripts/            开发启动、内容校验
```

### 数据

- `data/echo.db`：会话、逐轮转写、作文、评分、复习状态、设置。
- 音频默认不落盘。浏览器识别由浏览器厂商处理；Whisper 模式会把录音发送到你配置的模型服务。
- 删除 `data/echo.db*` 即可重置全部学习数据。

### 测试

```bash
bun test
bun run validate:content
bunx tsc --noEmit
bun run build
```

`tests/stub-llm.ts` 是仅用于联调的本地假模型（`bun tests/stub-llm.ts`），不参与应用运行。

## 已知限制

- 数字人是内置 SVG 渲染，不是官方 Live2D Cubism 运行时。它使用同一套参数（口型开合/形状、眼睑、头部角度、身体摆动），可替换为正式 Live2D 模型，但需要自行取得 Cubism SDK 与模型授权。
- 发音评分、语调评分未实现；不要把它当作正式口语分数。
- 托福已按 2026 版适配 Speaking（7 × Listen and Repeat + 4 × Take an Interview，1–6 分）与 Writing（10 × Build a Sentence + 1 × Email + 1 × Academic Discussion，1–6 分）；托福 Reading / Listening 尚未覆盖。
- 单用户、本地运行，没有账号体系与多端同步。
- 题库为原创练习材料，不包含剑桥/ETS/考研官方真题。

## 许可

本项目采用 MIT License，详见 [LICENSE](LICENSE)。

题库、rubric 描述、场景与跟读材料均为本项目原创。请勿把剑桥、ETS 或考研官方真题原文批量导入并分发。
