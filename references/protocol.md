# 任务协议与调用

源码权威协议为 `scripts/schema.ts`（Zod 严格校验，拒绝未知字段）。脚本路径均相对 skill 目录；所有资源路径相对任务目录。宿主写 JSON 并执行，家长只需自然语言。

## 创建

```sh
npm --prefix <skill-dir> run workbook -- init --task <task-dir> --title 春季错题重做 --request '生成一份试卷'
npm --prefix <skill-dir> run workbook -- import-image --task <task-dir> --file <图片> --id S1
npm --prefix <skill-dir> run workbook -- status --task <task-dir>
```

`init --input <完整任务.json>` 可导入模型已整理内容；建议保留原始任务描述 `request`，未指定 `layout.paperSize` 时按规则推断。日期使用 Asia/Shanghai。完整示例见 `examples/task.json`。

核心字段：

- Worksheet：`schemaVersion:1,id,title,date,request,revision,stage,sources,questions,layout,conflicts,timings`；`grade` 可选。
- Source：`id,type:text|image,label,text?,asset?,originalAsset?,location?,status:pending|processing|complete|partial|failed|cancelled,coverage:unchecked|checked,scopeConfirmed:boolean,candidateCount?,error?`。每份来源都保留，即使失败或未入选。来源状态由模型实际处理结果更新；范围与完整性分开核对。
- Question：`id,sourceRefs:[{sourceId,location,originalNumber?,region?:[x,y,width,height]}],subject:math|chinese|english,type,blocks,selected,confirmation:pending|confirmed,issues:[{id,message,resolved,resolution?}],workspace?,columns?,answer?,editedByUser,version,excludedReason?`。来源引用至少一项；输出题号按学科、题型归组后的试卷顺序连续生成，稳定 ID、来源原题号和存储顺序不改。学生卷与答案册共用分组及题号。`status.sections` 返回大题顺序、名称、题数及 `{id,number}` 对照；家长按打印题号修改时先用此对照定位 ID。
- Layout：`paperSize:A3|A4,paperReason:explicit|exam|default,preset:standard|compact|spacious,fontPt:12..20,marginMm:10..30,columns:auto|1|2|3,cellMm:11|12,maxPages?`。默认 14pt/14mm/auto/11mm。切换纸型通过 `layout` 操作；不会缩放整张 A4。
- Workspace：`{mm:64,style:blank|lines|four-line}` 或 `{lines:4,style:lines}`，不能同时给 mm 与 lines。lines 按完整书写行计数：普通横线/空白每行 8mm，dictation 横线每行 14mm，four-line 每组 18mm。四线格毫米高度向上补足整组；普通横线将余量均分，不绘制窄尾行。题型下限是硬约束；choice/judgment/fill 已有题内作答位置时可设 mm:0。显式 mm/lines 不受预设乘数影响；仅指定 style 不关闭预设或长短语自动扩容。
- Answer：`{text,verified,provenance,expression?}`。`verified:true` 表示宿主已核对且有依据；学生作答不是答案依据。expression 是纯数字四则算式，生成答案册时再精确核算；不同等价小数/分数可接受。

## 内容块

```json
[
  {"type":"text","text":"保留题面；行内公式用 \\(x+1\\)"},
  {"type":"formula","tex":"\\frac{1}{2}+\\frac{1}{4}"},
  {"type":"options","items":["A. 1","B. 2"]},
  {"type":"image","asset":"resources/diagram.png","alt":"解题必要图示","widthMm":80,"minWidthMm":45,"containsWork":false,"retainWorkConfirmed":false},
  {"type":"table","rows":[["项目","数量"],["苹果","12"]]},
  {"type":"pinyin","text":"lǜ sè","cells":2},
  {"type":"copy","word":"认真","repeats":3},
  {"type":"dictation","chinese":"苹果","english":"apple","direction":"zh-en"},
  {"type":"subquestion","label":"（1）求面积。","blocks":[{"type":"text","text":"写出过程。"}],"workspace":{"mm":24}}
]
```

子题不能再嵌套子题；长阅读拆成 text 段落、表格行组和独立小题。公式不拆中间、无效 KaTeX 报错。题图只接受任务内 PNG/JPEG/WebP（拒绝目录逃逸与外部资源），按原比例输出并设最小可读宽度；宿主必须据实际清晰度设置合理值。

## 原子修订

先读 status，再写补丁文件：

```json
{"expectedRevision":1,"operations":[
  {"op":"addSource","source":{"id":"S1","type":"text","label":"家长文字","text":"28+37=","status":"complete","coverage":"checked","scopeConfirmed":true}},
  {"op":"addQuestion","question":{"id":"Q1","subject":"math","type":"oral","sourceRefs":[{"sourceId":"S1","location":"第1题"}],"blocks":[{"type":"text","text":"28 + 37 = ______"}]}},
  {"op":"confirm","id":"Q1"}
]}
```

`npm --prefix <skill-dir> run workbook -- apply --task <task-dir> --input <patch.json>`

支持操作：

| op | 其他参数 | 行为 |
| --- | --- | --- |
| addSource | source | 加来源；照片优先 import-image 以保存资源 |
| updateSource | id, changes | 改处理状态/范围/覆盖，不直接换内容 |
| addQuestion | question | 加候选题，默认 pending/selected |
| updateQuestion | id, changes | 改块、题型、来源、答案、书写区；题意变化重置确认，答案也失效 |
| addIssue | id, issue:{id,message} | 记录具体疑点，该题 pending |
| resolveIssue | id, issueId, resolution | 只解决指定疑点，不自动确认整题 |
| confirm | id | 无未决项、题图保留已获确认才成功 |
| retainImageWork | id, asset, confirmed:true | 记录家长同意保留含作答原图，之后 confirm |
| select | id, selected, reason? | 排除/恢复，不删除，原顺序保留 |
| reorder | ids | 完整列出所有题目 ID 各一次，包含排除题；改变题型组内顺序及学科首次出现顺序，输出仍优先按题型归组 |
| layout | changes | 改纸型、预设、字号、栏数、边距或格子，不改题意确认 |
| metadata | changes | 仅 title/grade/date |
| merge | ids, question | 新题保留所有来源定位，人工核对合并后的块；新题 pending |
| split | id, questions | 至少两题，保留来源，均 pending |
| reidentify | sourceId, source?, questions | 新识别结果 pending，人工改过的版本保存为 conflicts，未返回的旧候选题仍保留待处理 |
| resolveConflict | id, choice:keep|replace | 先向家长展示 old blocks 与 proposal blocks 差异；replace 后 pending |
| timing | timing:{stage,durationMs} | 记录宿主整理、疑点等待等真实耗时，不记录题面日志 |

所有操作完整校验后才保存。修订冲突不写入；重新读任务再合并。`revisions/rNNNN.json` 是可恢复完整快照；需回退时读取该快照并以当前修订应用内容更改，不能让旧异步结果覆盖新任务。

## 生成与报告

```sh
npm --prefix <skill-dir> run workbook -- validate --task <task-dir>
npm --prefix <skill-dir> run workbook -- preview --task <task-dir>
npm --prefix <skill-dir> run workbook -- export --task <task-dir> --answers
```

每次生成目录 `exports/rNNNN-随机标识/`，包含离线 HTML、正式导出时的 PDF、全部页面 PNG 和 `report.json`。文件名含标题、纸型、日期与修订。报告包含 status、fingerprint、layout.questionPages、页数、字号、减栏/续页提示、PDF 尺寸、耗时、浏览器版本、排除题及未决项。`latest.json` 只指向与当前任务一致的成功结果；旧结果标 stale。失败目录保留诊断，重复命令只重试生成，不重新录题。学生 HTML 不嵌入完整任务 JSON。
