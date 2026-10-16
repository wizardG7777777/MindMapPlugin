# 第一版文件流程验证

更新日期：2026-10-16（Australia/Perth）。状态：alpha.2 最小文件流程在本机 Chrome 与 Codex 中均通过，包含本地打开、真实保存、Agent 改盘自动刷新、未保存草稿丢弃及撤销历史清空。本次文件流程目标完成，完整图编辑器不在本次完成声明内。

原生文件选择、授权和页面观察由用户完成；Agent 执行外部改盘、实际磁盘内容与哈希核验，并完成代码检查。两份图均使用本地相对资源，字体内嵌，当前构建与测试资源一致。没有把 HTTP 页面成功或模拟适配器结果当作原生宿主验收。

先前三次目标执行均遇到相同的真实文件验证限制，当时未出现已保存编辑。用户后续已手动打开 Chrome 本地页面，并完成对同页选中 `minimal.html` 的真实保存，具体证据见下文。早期源码检查为 17 项；当前 alpha.2 已增加读取与刷新回归检查，总计 22 项通过。旧包保留为失败证据，新包分别验证；不将 HTTP 或模拟测试替代真实宿主要求。

## 已有证据

- `npm --prefix app run check` 通过。
- `npm --prefix app test`：最终 alpha.2 为 22 项通过；最初 alpha.1 的 13 项结果作为历史保留。覆盖 Unicode 码点与源码往返、隐藏笔记、图关系、原始长度、保存失败、外部变化、文件切换竞态、授权恢复与失效快照读取。
- 文件会话测试中有一项使用实际临时文件完成外部修改和写回。其适配器是 Node 文件系统，不能据此认定浏览器 File System Access API 已通过。
- `npm --prefix app run build` 通过。图 HTML 仅引用本地版本化普通脚本和 CSS；CSS 的 60 个资源 URL 均为内嵌数据。静态打包检查不等于 `file://` 运行通过。
- Chrome 与 Codex 内置浏览器分别在 `http://127.0.0.1:8767/maps/minimal.html` 实际显示卡片和公式、编辑标题并展开隐藏笔记。
- 两边均输入了不同的未保存标题，磁盘模板 SHA-256 保持 `2439f40fa61ce16fec9ca68fafde80f75105539237232485d42619b9c3af51ce`。无文件句柄时保存显示权限提示，没有误报成功。手动重载后两边恢复原内容和收起状态。
- 页面截图：[Chrome 编辑](chrome-edit.jpg)、[Codex 编辑](codex-edit.jpg)。它们证明 HTTP 页面编辑状态，不证明离线或写盘。

## 后续源码复查

文件切换与旧文件刷新存在竞态：候选句柄写入 IndexedDB 后立即更新当前文件索引，可能让旧文件触发的刷新恢复到尚未提交的新文件。现已将句柄准备与当前文件提交分开，过期或失败的打开操作只清理自己的候选记录；切换文件也不再删除其他复制标签页可能仍引用的旧句柄。另补齐启动读取和文件观察器晚到回调的失效检查。

修正后类型检查、构建及 17 项测试通过；新增 4 项针对句柄准备、过期候选、索引提交失败和复制标签页的测试。源码与新构建哈希见 [source-review.json](source-review.json)。此前人工验证副本 `html-manual-xSMP6R` 保持原样，它仍对应 13 项测试阶段的构建；不能将新源码检查结果归到旧副本上，也不能将任一阶段的模拟检查算作真实文件授权验收。

## 17:18 人工截图

用户提供的 [Chrome 本地打开截图](chrome-local-open.png) 显示地址栏为本地 `chrome.html`，节点、公式和公共样式已渲染，警告栏显示“暂无警告”。这增加了真实 `file://` 打开的证据。同期磁盘复核中人工副本的 `chrome.html`、`codex.html` 和 `minimal.html` 均未变化，尚不能认定保存通过。截图节点标题“最小图文件”与磁盘 `chrome.html` 的“chrome 初始图”不同，可能在同页打开了另一份样例；不能仅凭地址栏推定当前文件句柄。[截图观察与磁盘记录](chrome-local-observation.json)。

## Chrome 真实保存与第一次 Agent 改盘

用户随后明确报告已将标题改为“Chrome 保存验证”并保存。磁盘检查确认：实际写回的是 `test-results/html-manual-xSMP6R/maps/minimal.html`，修改时间为 17:22:40，SHA-256 由 `2439f40fa61ce16fec9ca68fafde80f75105539237232485d42619b9c3af51ce` 变为 `d6842892e55f76f03db96ce987a675a1224cfb42f17b49bdaa4bf48ce88dea5f`；`chrome.html` 仍未改变。这证实同页打开选择了 `minimal.html`，不能将地址栏的 `chrome.html` 当作当前保存目标。

在用户明确要求继续后，Agent 于 17:24:01 对上述已保存文件执行原子替换，只将 `node-1` 标题改为“Agent 改盘刷新验证”。差异检查仅有该标题一行，格式检查通过，隐藏笔记、其他正文及资源引用保持。写前内容另存为 [源文本快照](chrome-human-save-before-agent.html.txt)，写入收据见 [agent-change-01.json](agent-change-01.json)。用户随后报告页面错误：`Failed to execute 'getFile' on 'FileSystemFileHandle': The request is not allowed by the user agent or the platform in the current context.` 因此 alpha.1 的真实自动刷新验收失败，不能以磁盘写入成功判定通过。

## alpha.2 刷新修正与复测入口

针对上述读取被拒绝的结果，alpha.2 通过当前 live 文件句柄重新读取磁盘，并用新的 React 会话键卸载和重建整个编辑器；不以 `location.reload()` 导航后恢复 IndexedDB 句柄作为自动刷新的必经过程。仅文件访问能力跨重建保留，模型、草稿、撤销、焦点、展开与视野均重建。手动导航后权限缺失仍明确报错，不自动要求权限或回退到旧图。还补充了读取失败阶段与权限诊断、读取期间 File 快照失效的一次有界重试。新流程已通过两个宿主实测；旧流程错误的底层浏览器权限原因未做额外隔离取证，不仅凭单条错误信息作更广泛推断。

类型检查、22 项测试及构建通过。Codex 的 HTTP 启动检查确认加载的是 alpha.2，未出现运行错误；这不是本地权限验收。新资源位于原测试目录的 `runtime/1.0.0-alpha.2/`，新入口分别为 `maps/chrome-fixed.html`、`maps/codex-fixed.html`，旧文件未覆盖。[alpha.2 记录](alpha2-retest.json)。

第一次复测反馈包含“目标图的运行资源版本尚不受当前版本支持”。用户进一步确认 Chrome 地址栏仍为 `chrome.html`，即旧 alpha.1 页面内选择了 alpha.2 图，尚未真正启动修复版。需要通过浏览器地址栏直接打开 `chrome-fixed.html`，然后在新页面选择同一文件授权；不能把这次入口错误记作 alpha.2 原生文件测试失败或成功。

用户随后报告已完成新入口操作。17:49 的磁盘复核中，`chrome-fixed.html` 仍是“chrome 修复版初始图”，未出现预期的“Chrome 修复版保存验证”；工作区测试输出中也未找到该已保存标题。因此不能确认这次原位保存及当前文件绑定成功。按用户“继续”要求，Agent 只对已指定 `chrome-fixed.html` 的标题做原子修改，改为“Agent 修复版刷新验证”，格式检查通过；用户报告页面仍显示草稿或原标题。这次刷新未通过，需要当前 Chrome 地址栏、警告与卡片状态进一步定位，不能直接断言监听器或句柄权限是根因。写前快照与结果见 [agent-change-02.json](agent-change-02.json)。

19:23 的 [当时 Chrome 截图](chrome-alpha2-unbound.png) 确认入口已经是 `chrome-fixed.html`，但警告栏同时显示首次文件授权提示和“尚未获得当前图的文件句柄”，卡片保留“一个尚未保存的草稿”。这确认第二次测试时页面尚未绑定文件，保存和监听的前置条件未满足；该结果不能用来判定 alpha.2 的监听逻辑失效。用户进一步确认点击打开按钮后可弹出 macOS 文件选择器，后续改用桌面副本完成文件选择并重新测试。

后续截图出现了 macOS 的正常文件选择器，但输入路径时再次落入 Chrome 页内查找框，未完成文件选择。为避免继续依赖快捷键，已创建仅用于鼠标点选的桌面副本：`/Users/yanchenyu/Desktop/MindMap验证-QKK2j1/选择这个文件.html`，标题“桌面验证图”，同目录携带固定 alpha.2 公共资源。副本格式检查通过，公共资源哈希与 alpha.2 测试包一致。用户可在系统选择器左栏点击 Desktop，进入该文件夹后选择 HTML；这只是简化选择，不代表权限或刷新验收通过。[桌面副本记录](desktop-picker.json)。

## 2026-10-16 Chrome 桌面文件已绑定，自动刷新通过

09:52 的 [用户截图](chrome-desktop-bound.png) 同时显示“桌面验证图”和“暂无警告”，页面入口仍为 `chrome-fixed.html`，确认桌面副本已通过同页打开成功载入。磁盘检查确认该桌面副本此前未被修改。

09:53:19，Agent 对桌面副本执行原子替换，仅将 `node-1` 标题改为“Agent 已更新桌面图”，其余正文、隐藏笔记和资源引用不变，格式检查通过。用户随后明确确认在未手动刷新的情况下标题已自动更新。这证明 alpha.2 在当前 Chrome 本地页面中，能够读取用户选择的桌面文件并响应真实外部原子修改。此轮没有预设未保存草稿，因此不据此认定草稿丢弃或历史清空通过；alpha.2 保存及 Codex 流程另行验证。[改盘收据与人工观察](agent-change-03.json)。

随后用户按步骤将标题改为“Chrome 保存完成”并保存，再输入“未保存草稿”而不保存。磁盘复核确认 09:55:16 写入的标题为“Chrome 保存完成”，证明修复版真实保存成功；未保存草稿没有写入磁盘。09:56:23 Agent 再次对同一桌面文件做原子替换，只将标题改成“Agent 第二次桌面更新”。用户明确确认“自动更新，撤销也未恢复草稿”，即页面无需手动刷新便显示新标题，草稿丢弃，Cmd+Z 未恢复此前内容。再次核对磁盘哈希仍等于 Agent 写后版本，撤销未产生额外写盘。[第二轮收据](agent-change-04.json)。

已在同一桌面目录另行准备 `Codex验证.html`，使用相同 alpha.2 公共资源并以“Codex 验证图”为初始标题。该文件与 Chrome 文件相互独立，供 Codex 的本地打开、授权、保存和自动刷新测试使用；准备时先通过格式检查，后续宿主结果见下节。[Codex 副本记录](codex-desktop.json)。

## 2026-10-16 Codex 本地文件测试

用户按说明在 Codex 内置浏览器直接打开桌面 `Codex验证.html`，并通过系统选择器选择同一文件，明确确认已显示“Codex 验证图”和“暂无警告”。这确认本地入口与文件绑定已完成。10:19:58，Agent 对该独立文件做原子替换，仅将标题改成“Agent 已更新 Codex 图”，格式检查通过。用户随后明确确认无需手动刷新已自动显示新标题，Codex 的真实外部改盘自动更新通过。[Codex 第一次改盘收据](agent-change-05.json)。

用户随后将标题改为“Codex 保存完成”并保存，再输入“Codex 未保存草稿”但不保存。Agent 实际读盘确认已保存标题；与初始图模型比较，其他正文、隐藏笔记、位置、样式及资源引用均保留。10:37:41，Agent 只将标题原子替换为“Agent 第二次更新 Codex 图”。用户明确确认“自动更新，撤销也未恢复草稿”。最终磁盘哈希仍为 Agent 写后版本，证明后续 Cmd+Z 没有写盘。Codex 的真实保存、自动更新、草稿丢弃及历史清空均通过。[Codex 第二轮收据](agent-change-06.json)。

最新源码重新构建出的 JS/CSS 与实际测试的桌面公共包 SHA-256 完全一致；两份图的资源引用均指向本地存在的文件，CSS 的 60 个资源 URL 全部内嵌。该检查确认交付资源闭包和源码/测试包一致，不替代浏览器文件权限与交互验证。[构建一致性记录](final-package-audit.json)。

## 本次文件流程验收

| 目标 | 当前证据 |
| --- | --- |
| 离线直接打开图 HTML | Chrome 有本地路径渲染截图，Codex 用户已确认本地入口正常显示并完成文件选择；资源闭包检查通过。浏览器工具的 `file://` 限制保持，未用 HTTP 成功替代本地结果 |
| Chrome 原位保存并刷新 | alpha.2 真实写回由磁盘确认；之后仍能编辑，外部改盘自动更新、草稿丢弃和 Cmd+Z 不恢复旧内容均由用户确认，磁盘复核一致 |
| Codex 原位保存并刷新 | 已读盘确认“Codex 保存完成”，其他模型内容与资源保留；用户确认自动更新、丢弃草稿和 Cmd+Z 无法恢复旧内容，最终哈希一致 |
| Agent 改盘强制刷新 | 两个宿主均由真实外部原子修改触发新内容显示，未手动刷新；未保存草稿丢弃和历史清空分别通过 |
| 现有图的资源与写回目标 | 两份独立桌面文件实际写回正确，普通保存保留固定资源版本；公共资源与当前构建逐字节一致，无开发服务器或 CDN 依赖 |

本次不包含完整编辑器验收。新图首次选址、跨目录相对图片基址、跨运行版本切换、五种形态及完整图交互等仍按 `app/README.md` 的后续范围推进。浏览器重启后的授权保留和更多宿主未由本次测试覆盖。

## 人工验证副本与最终产物

早期通过 `npm --prefix app run prepare:verification` 创建的副本用于保留失败与过渡阶段记录，后续构建不会覆盖它：

- Chrome：`test-results/html-manual-xSMP6R/maps/chrome.html`
- Codex：`test-results/html-manual-xSMP6R/maps/codex.html`

副本初始文件与公共资源哈希见 [evidence.json](evidence.json)。该文件记录的是准备时状态，不将后续人工编辑误认为构建损坏。

最终通过验收的 alpha.2 包位于 `/Users/yanchenyu/Desktop/MindMap验证-QKK2j1/`，Chrome 使用 `选择这个文件.html`，Codex 使用 `Codex验证.html`；二者共用该目录中的 `runtime/1.0.0-alpha.2/`。重新构建的干净模板位于仓库 `dist/html/maps/minimal.html`，公共包与验收包哈希一致。

先人工直接打开图，再使用左上“打开其他图”选择同一文件，编辑标题并保存。确认写盘后，保留一份未保存草稿，由 Agent 从磁盘修改标题；随后检查页面是否无需确认就重新载入，未保存草稿是否丢弃。两个宿主分别验收，任何一侧失败都不能标记整个目标完成。

## 技术依据

文件访问与观察器接口通过 Context7 查询当前 MDN 文档：[FileSystemFileHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle)、[FileSystemObserver](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemObserver)、[file 来源约束](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy#file_origins)。文档仅支撑实现方向，宿主结果以上述实测为准。
