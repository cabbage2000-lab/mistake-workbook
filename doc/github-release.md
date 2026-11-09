# GitHub 公开发布准备

公开源码仓库：[cabbage2000-lab/mistake-workbook](https://github.com/cabbage2000-lab/mistake-workbook)。WorkBuddy、Codex、Claude Code 共用一份技能包。本页保留首次发布前的验证记录，并提供后续上传与 Release 的操作步骤。

## 已准备的内容

- Git 默认分支为 `main`，远程地址为 `https://github.com/cabbage2000-lab/mistake-workbook.git`。
- `.gitignore` 排除依赖、输出、安装包、环境变量、常见密钥文件和编辑器缓存；`.gitattributes` 统一文本换行。
- README 的预览入口指向随源码提供的截图和检查记录，不依赖被忽略的本地 `output/`。
- 验收记录已移除本机用户名及临时目录绝对路径，保留历史测试结果；后续安装检查报告使用相对路径。
- 依赖锁文件的下载地址统一为官方 npm registry，独立安装验证固定使用该 registry 的本地缓存。
- 保留 MIT 许可、上游版权、中文字体 OFL 及第三方来源说明。
- `npm run package` 生成技能 ZIP 和 SHA-256 校验文件，并排除打包目录中的隐藏文件、临时文件、日志和符号链接。
- `.github/workflows/ci.yml` 在 Node.js 22、24 上执行依赖审计、类型检查、单元测试、浏览器/PDF 测试、打包及独立安装验证；使用固定提交版本的官方 Actions 和只读仓库权限。

依赖审计发现的公告已通过升级处理：KaTeX `0.18.2`、sharp `0.35.5`、Zod `4.6.7`。Zod 4 的布局默认值解析采用 `prefault` 保持原行为，并补充回归用例。公告依据：[KaTeX](https://github.com/KaTeX/KaTeX/security/advisories/GHSA-238p-pmpm-9mq7)、[sharp](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w)、[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)；依赖审计不等同于完整代码安全审计。

## 本次检查结果（2026-11-09）

| 检查 | 结果 |
| --- | --- |
| 类型检查 | 通过 |
| 数据 / 状态测试 | 29 / 29 通过，包含 Zod 布局默认值回归 |
| 浏览器 / PDF 集成测试 | 13 / 13 通过；本机 Node.js 24.13.0、Chrome 157.0.8103.38 |
| npm 依赖审计 | 0 项公告命中，见 [审计 JSON](evidence/dependency-audit.json) |
| 独立安装 | ZIP 解压、官方 registry 缓存离线安装、预览、学生卷与答案册、缺字体失败及恢复均通过，见 [安装验证](evidence/github-install-smoke.json) |
| 源码与安装包 | 本地文档链接、ZIP 完整性、SHA-256、包内文件与源码一致性、生成目录排除均通过 |
| 公开内容检查 | 常见密钥模式、本机用户路径和内网地址扫描未命中；截图为合成题目，无学生姓名填写 |
| GitHub 环境 | 首次发布前已验证 Git / GitHub CLI 可用且登录正常 |

以上是首次发布前的工作区检查记录。历史验收截图不代表依赖升级后的重新截图；三客户端交互、真实附件准确率及实际纸质打印仍按下表验收，远程 CI 结果以 [GitHub Actions](https://github.com/cabbage2000-lab/mistake-workbook/actions/workflows/ci.yml) 为准。

## 上传前检查

在项目根目录执行：

```sh
npm ci --registry=https://registry.npmjs.org
npx playwright install chromium
npm audit
npm run test:all
npm run package
npm run test:install
```

Linux 的浏览器环境可用 `npx playwright install --with-deps chromium` 准备。安装验证在临时目录运行；`npm ci --offline` 需要此前缓存依赖，报告写入被忽略的 `output/install-smoke.json`。

校验安装包（macOS / Linux）：

```sh
cd dist
shasum -a 256 -c mistake-workbook.zip.sha256
cd ..
```

检查提交候选文件；执行 `git add` 后再次检查暂存内容：

```sh
git status --short
git ls-files --others --exclude-standard
git add .
git diff --cached --check
git diff --cached --stat
```

确认没有真实学生材料、凭据和本机配置后再创建首次提交。当前图片和题目为合成验收素材。完整样张保留在本地 `output/exam-by-type/`，依赖与生成文件不提交。

## 发布状态与后续验收

| 任务 | 状态 / 完成条件 |
| --- | --- |
| 公开仓库归属及名称 | `cabbage2000-lab/mistake-workbook` |
| GitHub 登录与提交身份 | 已验证本机 GitHub CLI 登录可用，使用现有 Git 姓名和邮箱配置 |
| 仓库地址 | `package.json` 已配置 `repository`、`bugs`、`homepage`，中英文 README 已添加 CI 徽章 |
| 查看 GitHub CI 结果 | 上传后确认 Node.js 22、24 两项均通过，本地通过不能替代远程结果 |
| 三宿主客户端验收 | 分别验证技能发现、附件读图、导出和恢复；当前支持声明基于共同技能结构及本地执行流程 |
| 人工打印与使用验收 | 按 A3/A4、100% 抽打，核对实际书写空间；家长耗时与真实附件转录准确率仍待验证 |

## 上传方式

首次建立空远程时使用以下命令。已有 `origin` 时，后续更新使用下方的普通提交与推送流程。

```sh
git commit -m "Initial release of mistake-workbook skill"
gh auth status
gh repo create cabbage2000-lab/mistake-workbook --public --source=. --remote=origin --push
```

已有远程仓库时，改为关联它的真实 URL 后推送。不要对不明远程使用强制推送。

后续更新：

```sh
git add .
git diff --cached --check
git commit -m "Describe the change"
git push origin main
```

`package.json` 的 `private:true` 保留，用于阻止误发 npm 包；它不控制 GitHub 仓库可见性。建立远程后可按项目需要启用分支保护、漏洞告警及秘密扫描。

## 可选：发布可下载的技能包

首次源码上传后，确认 CI 成功，再发布与 `package.json` 版本一致的标签及 GitHub Release。将同一轮验证生成的 `dist/mistake-workbook.zip` 和 `dist/mistake-workbook.zip.sha256` 一起作为 Release 附件，ZIP 不必提交进 Git 历史。避免发布旧包或只更新校验文件。

CI 所用官方 Actions 文档：[checkout](https://github.com/actions/checkout)、[setup-node](https://github.com/actions/setup-node)、[upload-artifact](https://github.com/actions/upload-artifact)。
