# 第三方来源与许可

`scripts/arithmetic.ts` 复用 study-sheet 的精确有理数计算器；字体文件及 OFL 文本来自该包。排版实现参考其“Pretext 预估 + DOM 复核”的方法，独立实现任务协议、A3/A4、题图、复合块、版本与恢复。本项目保留原 MIT 许可版权声明，运行不读取其他 skill 目录。

| 组件 | 来源 / 许可 |
| --- | --- |
| study-sheet | https://github.com/cabbage2000-lab/study-sheet · MIT，见 [LICENSE](../LICENSE) |
| Noto Sans SC | https://github.com/google/fonts/tree/main/ofl/notosanssc · SIL OFL，见 [OFL.txt](../assets/fonts/OFL.txt) |
| Pretext | https://github.com/chenglou/pretext · MIT |
| KaTeX | https://github.com/KaTeX/KaTeX · MIT |
| Playwright | https://github.com/microsoft/playwright · Apache-2.0 |
| sharp | https://github.com/lovell/sharp · Apache-2.0（原生依赖另见对应 npm 包许可） |
| esbuild / pdf-lib / tsx / Zod | 各 npm 包所附 MIT 许可 |

精确版本见 package-lock.json。离线 HTML 附带中文字体、KaTeX、Pretext 与复用源码许可文本。中文字体 SHA-256：`06f2b103c174d580ba48c69fc7dcbb63b002cce5ce82ea15a05ad0baa4d2ec5a`。完整包带字体，无首次字体下载依赖；浏览器另行安装。
