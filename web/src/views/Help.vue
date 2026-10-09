<template>
  <div class="help-page">
    <!-- 目录侧边栏 -->
    <el-row :gutter="20">
      <el-col :xs="24" :lg="5">
        <div class="toc-card">
          <div class="toc-title">📚 目录</div>
          <div class="toc-list">
            <a v-for="s in sections" :key="s.id" :href="'#' + s.id" :class="{ active: active === s.id }" @click.prevent="jumpTo(s.id)">
              {{ s.title }}
            </a>
          </div>
        </div>
      </el-col>

      <el-col :xs="24" :lg="19">
        <!-- 1. 首次初始化 -->
        <el-card class="section-card" id="sec-init">
          <h2>一、首次初始化</h2>
          <el-alert type="info" :closable="false" show-icon class="mt-8">
            首次部署后，系统处于「未初始化」状态。访问任意页面会自动跳转到初始化页面。
            初始化<span style="color:#f56c6c">仅可执行一次</span>，完成后该接口永久关闭。
          </el-alert>
          <h3>操作步骤</h3>
          <ol class="step-list">
            <li>浏览器访问你的域名（例如 <code>https://your-domain.com</code>），自动跳转到 <code>/#/init</code> 初始化页面。</li>
            <li>输入管理员用户名：<b>3-32 字符，字母开头，仅字母、数字、下划线</b>。例如 <code>admin</code>。</li>
            <li>输入密码：<b>至少 8 位，必须同时包含字母和数字</b>。例如 <code>Abcd1234</code>。</li>
            <li>再次输入确认密码，两次输入必须一致。</li>
            <li>（可选）配置 Cloudflare Turnstile 人机验证，详见下文「人机验证」章节。</li>
            <li>点击「完成初始化」。成功后自动登录并进入仪表盘。</li>
          </ol>
          <el-alert type="warning" :closable="false" show-icon class="mt-16">
            ⚠️ <b>重要</b>：初始化前请务必备份服务器 <code>.env</code> 中的
            <code>MASTER_KEY</code> 和 <code>JWT_SECRET</code>。这两个密钥丢失将导致
            全部加密存储的 secret 失效且无法恢复。
          </el-alert>
        </el-card>

        <!-- 2. 登录 -->
        <el-card class="section-card" id="sec-login">
          <h2>二、登录</h2>
          <h3>操作步骤</h3>
          <ol class="step-list">
            <li>访问域名，自动跳转到 <code>/#/login</code> 登录页。</li>
            <li>输入管理员用户名和密码。</li>
            <li>如果开启了 Turnstile 人机验证，先完成验证（点击勾选框）。</li>
            <li>点击「登录」或按回车键提交。</li>
          </ol>
          <h3>安全机制</h3>
          <ul class="dot-list">
            <li><b>密码加密传输</b>：密码在浏览器端先进行 SHA-256 哈希，再通过 HTTPS 传输，服务端用 bcrypt 二次加密存储。明文密码永远不会离开你的浏览器。</li>
            <li><b>登录限流</b>：同一 IP 连续失败 5 次会被锁定一段时间，防止暴力破解。</li>
            <li><b>人机验证</b>：可配置 Cloudflare Turnstile，进一步防止自动化攻击。</li>
          </ul>
          <el-alert type="info" :closable="false" show-icon class="mt-8">
            忘记密码？在服务器执行 <code>./go.sh reset-password --username=用户名 --password=新密码</code> 重置。
          </el-alert>
        </el-card>

        <!-- 3. 仪表盘 -->
        <el-card class="section-card" id="sec-dashboard">
          <h2>三、仪表盘</h2>
          <p>登录后默认进入仪表盘，提供今日推送概览和系统状态。</p>
          <h3>页面内容</h3>
          <ul class="dot-list">
            <li><b>今日推送总数</b>：当天通过所有 Token 推送的消息总条数。</li>
            <li><b>成功率</b>：成功推送数 / 推送总数 × 100%，含成功和失败的具体条数。</li>
            <li><b>失败数</b>：当天推送失败的条数。</li>
            <li><b>活跃 Token</b>：当前启用状态的 Token 数量。</li>
            <li><b>近 7 天推送趋势图</b>：可切换「总量」和「成功率」两个视图。</li>
            <li><b>access_token 缓存状态</b>：企业微信 access_token 的过期时间，可手动刷新。</li>
            <li><b>活跃 Token Top10</b>：今日推送量最高的 10 个 Token。</li>
          </ul>
          <h3>手动刷新 access_token</h3>
          <ol class="step-list">
            <li>在「access_token 缓存状态」表格中找到对应应用。</li>
            <li>点击「手动刷新」按钮。</li>
            <li>系统会立即向企业微信获取新的 access_token 并缓存。</li>
          </ol>
        </el-card>

        <!-- 4. 应用管理 -->
        <el-card class="section-card" id="sec-apps">
          <h2>四、应用管理（企业微信应用消息）</h2>
          <p>企业微信「应用消息」渠道：通过企业自建应用向指定用户/部门/标签推送消息。</p>
          <h3>前置准备</h3>
          <ol class="step-list">
            <li>登录 <a href="https://work.weixin.qq.com" target="_blank" rel="noopener">企业微信管理后台</a>。</li>
            <li>进入「应用管理」→「自建」→「创建应用」，填写应用名称、Logo、可见范围。</li>
            <li>创建后记录 <b>AgentId</b>。</li>
            <li>点击「Secret」右侧的查看，获取 <b>Secret</b>（需要管理员扫码确认）。</li>
            <li>在「我的企业」页面底部获取 <b>企业 ID（CorpID）</b>。</li>
          </ol>
          <h3>添加应用</h3>
          <ol class="step-list">
            <li>左侧菜单点击「应用管理」，进入应用列表页。</li>
            <li>点击右上角「添加应用」按钮，弹出抽屉表单。</li>
            <li>填写字段：
              <ul class="dot-list">
                <li><b>应用名称</b>：备注名，仅在本系统显示，方便记忆。</li>
                <li><b>CorpID</b>：企业 ID。</li>
                <li><b>AgentID</b>：应用 ID。</li>
                <li><b>Secret</b>：应用 Secret，系统会 AES-256-GCM 加密存储。</li>
                <li><b>允许 @所有人</b>：是否允许 Token 推送给所有成员（@all）。默认开启。</li>
                <li><b>@all 每日上限</b>：该应用 @所有人 的每日推送次数上限，默认 5 次/天。</li>
              </ul>
            </li>
            <li>点击「保存」。</li>
          </ol>
          <h3>后续操作</h3>
          <ul class="dot-list">
            <li><b>编辑</b>：修改应用配置（CorpID、AgentID、Secret 等）。</li>
            <li><b>删除</b>：删除前会检查是否有关联的 Token，有关联则禁止删除。</li>
          </ul>

          <h3>企业微信验证配置（可选）</h3>
          <p>在企业微信后台配置应用时，可能需要验证域名归属或配置消息接收。本系统支持两种验证方式，<b>二选一，非必填</b>：</p>

          <h4>方式一：可信域名验证</h4>
          <p>用于企业微信后台「可信域名」验证。上传验证文件后，系统会自动在你的域名根目录提供该文件供企业微信下载验证。</p>
          <ol class="step-list">
            <li>登录企业微信管理后台 → 应用管理 → 你的应用 → 找到「可信域名」区域。</li>
            <li>点击「下载文件」，获取形如 <code>WW_verify_kTbFlG9hHP2SCsBR.txt</code> 的验证文件。</li>
            <li>回到本系统应用管理 → 编辑应用 → 验证方式选择「可信域名验证」。</li>
            <li>点击「选择 WW_verify_*.txt 文件」上传刚下载的验证文件。</li>
            <li>保存后，系统自动在 <code>https://你的域名/WW_verify_xxxx.txt</code> 提供该文件访问。</li>
            <li>回到企业微信后台，填写可信域名（如 <code>your-domain.com</code>），点击保存完成验证。</li>
          </ol>

          <h4>方式二：接收消息服务器</h4>
          <p>用于企业微信后台「接收消息」→「设置 API」配置。系统自动生成回调 URL，你只需配置 Token 和 EncodingAESKey。</p>
          <ol class="step-list">
            <li>在本系统应用管理 → 编辑应用 → 验证方式选择「接收消息服务器」。</li>
            <li>系统自动生成回调 URL：<code>https://你的域名/api/wx/callback/{应用ID}</code>（无需手动填写）。</li>
            <li>点击 Token 右侧「随机生成」按钮，系统生成随机 Token。也可手动输入。</li>
            <li>点击 EncodingAESKey 右侧「随机生成」按钮，系统生成 43 字符随机密钥。也可手动输入。</li>
            <li>保存配置。</li>
            <li>复制上述三个值（回调 URL、Token、EncodingAESKey）。</li>
            <li>登录企业微信管理后台 → 应用管理 → 你的应用 → 接收消息 → 设置 API。</li>
            <li>将三个值填入对应字段，消息加密模式选择「安全模式」（推荐）。</li>
            <li>点击「保存」，企业微信会向你的回调 URL 发送验证请求，系统自动响应完成验证。</li>
          </ol>
          <el-alert type="info" :closable="false" show-icon class="mt-8">
            两种方式互斥：选择一种后另一种会自动清除。不配置也不影响推送功能，仅影响企业微信后台的域名验证和消息回调。
          </el-alert>
        </el-card>

        <!-- 5. 群机器人管理 -->
        <el-card class="section-card" id="sec-webhooks">
          <h2>五、群机器人管理</h2>
          <p>企业微信「群机器人」渠道：通过群机器人 Webhook 向群聊推送消息。</p>
          <h3>前置准备</h3>
          <ol class="step-list">
            <li>在企业微信群聊中，点击右上角「…」→「群机器人」→「添加机器人」。</li>
            <li>给机器人命名后，获取 Webhook 地址，格式为：<code>https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx-xxxx-xxxx</code></li>
            <li>记录 <code>key=</code> 后面的部分（即 <b>Webhook Key</b>）。</li>
          </ol>
          <h3>安全模式说明</h3>
          <table class="info-table">
            <thead>
              <tr><th>模式</th><th>说明</th><th>需要配置</th></tr>
            </thead>
            <tbody>
              <tr><td>none</td><td>不启用安全校验，任何人拿到 key 都能推送</td><td>无</td></tr>
              <tr><td>keyword</td><td>消息内容必须包含指定关键词</td><td>关键词</td></tr>
              <tr><td>sign</td><td>请求需携带加签签名（系统自动计算）</td><td>加签密钥</td></tr>
            </tbody>
          </table>

          <h4>keyword 模式详解</h4>
          <p>设置关键词后，每次推送的消息内容中<b>必须包含</b>该关键词，否则推送会被企业微信拒绝（错误码 41001）。</p>
          <ul class="dot-list">
            <li><b>关键词可以是任意字符串</b>，如 <code>告警</code>、<code>监控通知</code>、<code>deploy</code> 等。</li>
            <li>关键词不区分大小写。</li>
            <li>关键词会在消息正文的任意位置匹配（包含即可，不需要完全匹配）。</li>
            <li>一个机器人只能设置一个关键词。</li>
            <li>关键词在<b>企业微信群机器人设置页面</b>配置，不是在本系统中配置。</li>
          </ul>
          <p><b>示例</b>：假设关键词设置为 <code>告警</code>，推送内容必须是：</p>
<pre class="code-block">✅ 正确：{"type":"text","text":"服务器CPU告警：使用率 95%"}
✅ 正确：{"type":"markdown","desp":"## 磁盘告警\n/ 分区剩余不足 10%"}
❌ 错误：{"type":"text","text":"服务器CPU使用率 95%"}  ← 不含「告警」关键词，会被拒绝</pre>

          <h4>sign 模式详解</h4>
          <p>设置加签密钥后，每次推送请求需要携带签名参数。本系统会<b>自动计算签名</b>并附加到请求中，调用方无需额外处理。</p>
          <p>签名计算方式（企业微信标准）：</p>
          <ol class="step-list">
            <li>将 <code>timestamp</code>（当前时间戳秒）、<code>加签密钥</code> 拼接成字符串：<code>timestamp + 密钥</code></li>
            <li>对拼接后的字符串计算 <b>HMAC-SHA256</b> 哈希，得到签名 <code>sign</code></li>
            <li>请求中携带 <code>timestamp</code> 和 <code>sign</code> 参数</li>
          </ol>
          <p>加签密钥在<b>企业微信群机器人设置页面</b>生成，格式为 64 字符的随机字符串。在本系统添加机器人时填入即可，系统会自动加密存储并处理签名。</p>
          <p><b>配置步骤</b>：</p>
          <ol class="step-list">
            <li>在企业微信群聊中添加机器人时，安全模式选择「加签」。</li>
            <li>企业微信会生成一个加签密钥（64 字符），复制该密钥。</li>
            <li>在本系统添加群机器人时，安全模式选择 <code>sign</code>。</li>
            <li>将加签密钥粘贴到「加签密钥」字段。</li>
            <li>保存即可。之后所有通过该机器人 Token 的推送，系统会自动计算签名并附加到请求中。</li>
          </ol>
          <el-alert type="info" :closable="false" show-icon class="mt-8">
            <b>重要</b>：安全模式和安全密钥是在<b>企业微信群机器人设置页面</b>配置的。本系统只是将你配置的密钥加密存储，并在推送时自动计算签名。请确保两边的密钥一致。
          </el-alert>
          <h3>添加群机器人</h3>
          <ol class="step-list">
            <li>左侧菜单点击「群机器人」，进入列表页。</li>
            <li>点击「添加机器人」按钮。</li>
            <li>填写字段：
              <ul class="dot-list">
                <li><b>名称</b>：备注名。</li>
                <li><b>Webhook Key</b>：群机器人 key，AES 加密存储。</li>
                <li><b>安全模式</b>：选择 none / keyword / sign。</li>
                <li><b>关键词</b>：keyword 模式下必填，消息必须包含此词。</li>
                <li><b>加签密钥</b>：sign 模式下必填，AES 加密存储。</li>
              </ul>
            </li>
            <li>点击「保存」。</li>
          </ol>
        </el-card>

        <!-- 6. Token 管理 -->
        <el-card class="section-card" id="sec-tokens">
          <h2>六、Token 管理</h2>
          <p>Token 是推送接口的「钥匙」。调用方使用 Token 调用推送接口，系统根据 Token 的配置决定推送到哪个渠道、推送给谁。</p>
          <h3>创建 Token</h3>
          <ol class="step-list">
            <li>左侧菜单点击「Token 管理」，进入列表页。</li>
            <li>点击「生成 Token」按钮，弹出抽屉表单。</li>
            <li>填写字段：
              <ul class="dot-list">
                <li><b>名称</b>：备注名，如「服务端告警」。</li>
                <li><b>渠道类型</b>：选择「应用消息」或「群机器人」。</li>
                <li><b>选择应用 / 机器人</b>：下拉选择已创建的应用或群机器人。</li>
                <li><b>允许消息类型</b>：勾选该 Token 允许推送的消息类型（text/markdown/textcard/image/news）。</li>
                <li><b>限流（次/分钟）</b>：每分钟最大推送次数，0 表示不限。默认 60。</li>
                <li><b>IP 白名单</b>：允许调用的 IP 或 CIDR 段，空表示不限。例如 <code>192.168.1.0/24</code>。</li>
                <li><b>过期时间</b>：Token 过期时间，空表示永不过期。</li>
                <li><b>接收人（仅应用消息）</b>：添加接收人，可按用户 ID、部门 ID、标签 ID 三种类型添加。详见下方「接收人配置详解」。</li>
              </ul>
            </li>
            <li>点击「保存」，系统自动生成 32 位 base64url 格式的 Token 值。</li>
            <li>创建后点击「复制」复制 Token 值，供推送接口使用。</li>
          </ol>

          <h3>接收人配置详解（仅应用消息渠道）</h3>
          <p>应用消息 Token 可以绑定静态接收人列表，推送时系统自动向这些接收人发送消息。接收人支持三种类型：</p>

          <h4>类型一：用户 ID（user）</h4>
          <p>指定企业微信中的成员 ID（userid），向特定用户推送消息。</p>
          <ul class="dot-list">
            <li><b>格式</b>：企业微信成员的 userid 字符串，如 <code>zhangsan</code>、<code>lisi001</code>。</li>
            <li><b>获取方式</b>：登录企业微信管理后台 → 通讯录 → 点击成员 → 右侧详情中查看「账号」（即 userid）。</li>
            <li><b>特殊值 @all</b>：接收人值填写 <code>@all</code> 表示推送给应用可见范围内的所有成员。</li>
            <li>使用 <code>@all</code> 时，应用必须开启「允许 @所有人」，且受 @all 每日配额限制（默认 5 次/天）。</li>
          </ul>
          <p><b>示例</b>：</p>
<pre class="code-block">用户 ID 类型
接收人值：zhangsan       → 仅推送给张三
接收人值：lisi           → 仅推送给李四
接收人值：@all           → 推送给所有成员（受 @all 配额限制）</pre>

          <h4>类型二：部门 ID（department）</h4>
          <p>指定企业微信中的部门 ID，向该部门下所有成员推送消息。</p>
          <ul class="dot-list">
            <li><b>格式</b>：数字类型的部门 ID，如 <code>1</code>、<code>10</code>、<code>200</code>。</li>
            <li><b>获取方式</b>：登录企业微信管理后台 → 通讯录 → 点击部门 → 在部门名称下方查看「部门 ID」（或查看 URL 中的 id 参数）。</li>
            <li>根部门 ID 通常为 <code>1</code>。</li>
            <li>仅推送该部门直属成员，不包含子部门成员（由企业微信 API 决定）。</li>
          </ul>
          <p><b>示例</b>：</p>
<pre class="code-block">部门 ID 类型
接收人值：1              → 推送给根部门下所有成员
接收人值：10             → 推送给部门 ID 为 10 的部门所有成员</pre>

          <h4>类型三：标签 ID（tag）</h4>
          <p>指定企业微信中的标签 ID，向该标签下所有成员推送消息。</p>
          <ul class="dot-list">
            <li><b>格式</b>：数字类型的标签 ID，如 <code>1</code>、<code>5</code>、<code>100</code>。</li>
            <li><b>获取方式</b>：登录企业微信管理后台 → 通讯录 → 标签管理 → 点击标签 → 查看标签 ID。</li>
            <li>标签是跨部门的成员分组，适合按角色/职能推送（如「运维组」「开发组」）。</li>
          </ul>
          <p><b>示例</b>：</p>
<pre class="code-block">标签 ID 类型
接收人值：1              → 推送给标签 ID 为 1 的所有成员
接收人值：5              → 推送给标签 ID 为 5 的所有成员</pre>

          <h4>动态指定接收人</h4>
          <p>除了静态绑定的接收人列表，API v2 接口还支持在推送时通过 <code>toUser</code> 参数动态指定接收人：</p>
<pre class="code-block">curl -X POST https://your-domain.com/api/v2/openapi/messages/send \
  -H "X-API-Key: {token}" \
  -H "Content-Type: application/json" \
  -d '{"msgType":"text","content":"hello","toUser":"zhangsan|lisi"}'</pre>
          <p><b>注意</b>：<code>toUser</code> 中指定的用户必须是 Token 绑定接收人列表的子集，否则会返回 40305 错误。如果 Token 绑定了 <code>@all</code>，则可以指定任意用户。</p>
          <h3>管理操作</h3>
          <ul class="dot-list">
            <li><b>复制</b>：复制 Token 值到剪贴板。</li>
            <li><b>编辑</b>：修改 Token 配置（不改变 Token 值）。</li>
            <li><b>启用/停用</b>：临时禁用某个 Token。</li>
            <li><b>轮换</b>：生成新的 Token 值，旧 Token 立即失效。</li>
            <li><b>删除</b>：删除 Token。</li>
          </ul>
        </el-card>

        <!-- 7. 推送日志 -->
        <el-card class="section-card" id="sec-logs">
          <h2>七、推送日志</h2>
          <p>所有推送请求的详细记录，包括请求参数、响应结果、错误信息、耗时等。</p>
          <h3>筛选条件</h3>
          <ul class="dot-list">
            <li><b>Token</b>：按 Token 筛选。</li>
            <li><b>状态</b>：成功 / 失败 / 错误 / 限流。</li>
            <li><b>时间区间</b>：选择起止时间。</li>
          </ul>
          <h3>操作</h3>
          <ul class="dot-list">
            <li><b>查询</b>：按筛选条件加载日志。</li>
            <li><b>加载更多</b>：分页加载下一页。</li>
            <li><b>导出 CSV</b>：导出当前筛选结果为 CSV 文件。</li>
            <li><b>详情</b>：点击日志行的「详情」按钮，查看完整的请求体和响应体。</li>
          </ul>
        </el-card>

        <!-- 8. 调试发送 -->
        <el-card class="section-card" id="sec-debug">
          <h2>八、调试发送</h2>
          <p>在后台直接测试推送，无需编写代码。</p>
          <h3>操作步骤</h3>
          <ol class="step-list">
            <li>左侧菜单点击「调试发送」。</li>
            <li>选择目标 Token。</li>
            <li>选择消息类型：文本 / Markdown / 文本卡片 / 图片 / 图文。</li>
            <li>填写消息内容（不同类型字段不同，见下方推送接口文档）。</li>
            <li>点击「发送」。</li>
            <li>下方「响应结果」区域显示企业微信返回的完整响应。</li>
          </ol>
        </el-card>

        <!-- 9. 系统设置 -->
        <el-card class="section-card" id="sec-settings">
          <h2>九、系统设置</h2>
          <h3>9.1 全局配置</h3>
          <ul class="dot-list">
            <li><b>默认限流</b>：新创建 Token 的默认每分钟限流值（0-10000）。</li>
            <li><b>日志保留天数</b>：推送日志保留天数（1-365），超过自动清理。</li>
          </ul>
          <h3>9.2 人机验证（Cloudflare Turnstile）</h3>
          <p>开启后登录页显示人机验证组件，防止暴力登录。可选配置。</p>
          <ol class="step-list">
            <li>访问 <a href="https://dash.cloudflare.com" target="_blank" rel="noopener">Cloudflare 控制台</a>，进入 Turnstile，获取 Site Key 和 Secret Key。</li>
            <li>在系统设置「人机验证」卡片中填入 Site Key 和 Secret Key。</li>
            <li>点击「保存配置」。</li>
            <li>也可在 <code>.env</code> 中配置 <code>TURNSTILE_SITE_KEY</code> 和 <code>TURNSTILE_SECRET_KEY</code>。</li>
          </ol>
          <h3>9.3 修改密码</h3>
          <p>输入原密码和新密码（≥8 位，含字母+数字），点击修改。密码在浏览器端 SHA-256 哈希后传输。</p>
          <h3>9.4 access_token 手动刷新</h3>
          <p>选择应用后点击「刷新」，立即从企业微信获取新的 access_token。</p>
          <h3>9.5 日志清理</h3>
          <p>输入天数 N，立即清理 N 天前的日志，分批删除不阻塞推送。</p>
          <h3>9.6 数据库导出</h3>
          <p>导出 SQLite 数据库备份文件，用于备份或迁移。</p>
          <h3>9.7 MASTER_KEY 轮换</h3>
          <el-alert type="warning" :closable="false" show-icon class="mt-8">
            高风险操作！轮换后需更新 <code>.env</code> 并重启服务。务必提前备份。
          </el-alert>
          <p>提供旧 MASTER_KEY 和新 MASTER_KEY，系统用新密钥重新加密所有 secret 字段。</p>
        </el-card>

        <!-- 10. 推送接口文档 -->
        <el-card class="section-card" id="sec-api">
          <h2>十、推送服务接口文档</h2>
          <p>WxPush 提供三种推送接口风格，适配不同场景：</p>
          <table class="info-table">
            <thead>
              <tr><th>风格</th><th>方法</th><th>路径</th><th>鉴权方式</th><th>适用场景</th></tr>
            </thead>
            <tbody>
              <tr><td>URL 风格</td><td>GET/POST</td><td><code>/:token.send</code></td><td>URL 中的 token</td><td>Server 酱兼容、简单 GET 调用</td></tr>
              <tr><td>API v1</td><td>POST</td><td><code>/api/v1/push</code></td><td>X-API-Key 请求头</td><td>结构化 JSON 调用</td></tr>
              <tr><td>API v2</td><td>POST</td><td><code>/api/v2/openapi/messages/send</code></td><td>X-API-Key 请求头</td><td>企业微信 OpenAPI 兼容</td></tr>
            </tbody>
          </table>

          <h3>10.1 URL 风格（Server 酱兼容）</h3>
          <p>请求格式：<code>GET|POST https://your-domain.com/{token}.send</code></p>
          <p>参数通过 query string（GET）或 body（POST）传递，支持多种字段名兼容：</p>
          <table class="info-table">
            <thead>
              <tr><th>参数</th><th>类型</th><th>必填</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr><td>text / content / desp / title</td><td>string</td><td>是</td><td>消息正文，四个字段名等价，至少传一个，优先级 text &gt; content &gt; desp &gt; title</td></tr>
              <tr><td>type</td><td>string</td><td>否</td><td>消息类型：text（默认）/ markdown / textcard / image / news</td></tr>
              <tr><td>title</td><td>string</td><td>否</td><td>消息标题（textcard/news 必填）</td></tr>
              <tr><td>desp</td><td>string</td><td>否</td><td>Markdown 正文内容</td></tr>
              <tr><td>url</td><td>string</td><td>否</td><td>跳转链接（textcard/news/image 必填）</td></tr>
              <tr><td>description</td><td>string</td><td>否</td><td>描述（textcard/news）</td></tr>
              <tr><td>btntxt</td><td>string</td><td>否</td><td>按钮文字，默认「详情」</td></tr>
              <tr><td>picurl</td><td>string</td><td>否</td><td>图文封面图片 URL</td></tr>
            </tbody>
          </table>
          <el-alert type="info" :closable="false" show-icon class="mt-8">
            GET 请求总长度限制 8KB，超出请改用 POST。
          </el-alert>
          <p><b>示例（GET）</b>：</p>
<pre class="code-block">https://your-domain.com/ABCdEfGhIjKlMnOpQrStUvWxYz123456.send?type=markdown&title=标题&desp=**加粗内容**</pre>
          <p><b>示例（POST JSON）</b>：</p>
<pre class="code-block">curl -X POST https://your-domain.com/ABCdEfGhIjKlMnOpQrStUvWxYz123456.send \
  -H "Content-Type: application/json" \
  -d '{"type":"text","text":"hello world"}'</pre>

          <h3>10.2 API v1（结构化 JSON）</h3>
          <p>请求格式：<code>POST https://your-domain.com/api/v1/push</code></p>
          <p>请求头：<code>X-API-Key: {token}</code></p>
          <table class="info-table">
            <thead>
              <tr><th>字段</th><th>类型</th><th>必填</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr><td>msgType</td><td>string</td><td>否</td><td>text（默认）/ markdown / textcard / image / news</td></tr>
              <tr><td>content</td><td>string</td><td>是</td><td>消息内容（text/markdown 为正文；image 为图片 URL）</td></tr>
              <tr><td>title</td><td>string</td><td>否</td><td>标题（textcard/news）</td></tr>
              <tr><td>description</td><td>string</td><td>否</td><td>描述（textcard/news）</td></tr>
              <tr><td>url</td><td>string</td><td>否</td><td>跳转链接</td></tr>
            </tbody>
          </table>
          <p><b>示例</b>：</p>
<pre class="code-block">curl -X POST https://your-domain.com/api/v1/push \
  -H "X-API-Key: ABCdEfGhIjKlMnOpQrStUvWxYz123456" \
  -H "Content-Type: application/json" \
  -d '{"msgType":"markdown","content":"# 标题\n**加粗**"}'</pre>

          <h3>10.3 API v2（企业微信 OpenAPI 兼容）</h3>
          <p>请求格式：<code>POST https://your-domain.com/api/v2/openapi/messages/send</code></p>
          <p>请求头：<code>X-API-Key: {token}</code></p>
          <table class="info-table">
            <thead>
              <tr><th>字段</th><th>类型</th><th>必填</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr><td>msgType</td><td>string</td><td>否</td><td>text（默认）/ markdown / textcard / image / news</td></tr>
              <tr><td>content</td><td>string</td><td>是</td><td>消息内容</td></tr>
              <tr><td>toUser</td><td>string</td><td>否</td><td>指定接收用户，用 <code>|</code> 分隔。必须是 Token 绑定接收人的子集</td></tr>
              <tr><td>title</td><td>string</td><td>否</td><td>textcard 标题</td></tr>
              <tr><td>description</td><td>string</td><td>否</td><td>textcard 描述</td></tr>
              <tr><td>url</td><td>string</td><td>否</td><td>跳转链接</td></tr>
              <tr><td>btntxt</td><td>string</td><td>否</td><td>按钮文字</td></tr>
              <tr><td>articles</td><td>array</td><td>否</td><td>图文消息数组</td></tr>
            </tbody>
          </table>

          <h3>10.4 消息类型详解</h3>
          <table class="info-table">
            <thead>
              <tr><th>类型</th><th>说明</th><th>关键字段</th></tr>
            </thead>
            <tbody>
              <tr><td>text</td><td>纯文本消息</td><td>content / text</td></tr>
              <tr><td>markdown</td><td>Markdown 格式消息（企业微信支持子集）</td><td>content / desp</td></tr>
              <tr><td>textcard</td><td>文本卡片，带跳转链接</td><td>title, description, url, btntxt</td></tr>
              <tr><td>image</td><td>图片消息</td><td>url（图片地址）</td></tr>
              <tr><td>news</td><td>图文消息</td><td>articles 数组（title, description, url, picurl）</td></tr>
            </tbody>
          </table>

          <h3>10.5 统一响应格式</h3>
          <p>URL 风格和 API v1 返回：</p>
<pre class="code-block">{
  "code": 0,            // 0=成功，非 0=失败
  "message": "ok",      // 成功或失败信息
  "msgid": "xxx",       // 企业微信返回的消息 ID
  "timestamp": 1234567890
}</pre>
          <p>API v2 返回（企业微信兼容格式）：</p>
<pre class="code-block">{
  "errcode": 0,
  "errmsg": "ok",
  "msgid": "xxx"
}</pre>

          <h3>10.6 常见错误码</h3>
          <table class="info-table">
            <thead>
              <tr><th>code</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr><td>0</td><td>成功</td></tr>
              <tr><td>40001</td><td>参数错误（内容为空等）</td></tr>
              <tr><td>40002</td><td>消息类型不支持</td></tr>
              <tr><td>40101</td><td>Token 不存在</td></tr>
              <tr><td>40302</td><td>Token 已停用</td></tr>
              <tr><td>40303</td><td>Token 已过期</td></tr>
              <tr><td>40304</td><td>该应用不允许 @all</td></tr>
              <tr><td>40305</td><td>toUser 不在 Token 绑定接收人范围内</td></tr>
              <tr><td>41001</td><td>关键词模式下内容未包含指定关键词</td></tr>
              <tr><td>41301</td><td>GET 请求内容过大，请改用 POST</td></tr>
              <tr><td>42901</td><td>触发分钟级限流</td></tr>
              <tr><td>42902</td><td>@all 每日配额已用完</td></tr>
              <tr><td>≥50000</td><td>企业微信上游错误（errcode 透传）</td></tr>
            </tbody>
          </table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue';

const sections = [
  { id: 'sec-init', title: '一、首次初始化' },
  { id: 'sec-login', title: '二、登录' },
  { id: 'sec-dashboard', title: '三、仪表盘' },
  { id: 'sec-apps', title: '四、应用管理' },
  { id: 'sec-webhooks', title: '五、群机器人管理' },
  { id: 'sec-tokens', title: '六、Token 管理' },
  { id: 'sec-logs', title: '七、推送日志' },
  { id: 'sec-debug', title: '八、调试发送' },
  { id: 'sec-settings', title: '九、系统设置' },
  { id: 'sec-api', title: '十、推送接口文档' },
];

const active = ref('sec-init');

function jumpTo(id) {
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    active.value = id;
  }
}

function onScroll() {
  for (let i = sections.length - 1; i >= 0; i--) {
    const el = document.getElementById(sections[i].id);
    if (el && el.getBoundingClientRect().top <= 100) {
      active.value = sections[i].id;
      break;
    }
  }
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll, true);
});
</script>

<style scoped>
.help-page { max-width: 100%; }
.toc-card {
  position: sticky;
  top: 20px;
  background: #fff;
  border-radius: 8px;
  padding: 16px;
  border: 1px solid #ebeef5;
}
.toc-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #ebeef5;
}
.toc-list { display: flex; flex-direction: column; gap: 4px; }
.toc-list a {
  display: block;
  padding: 6px 10px;
  border-radius: 4px;
  color: #606266;
  font-size: 13px;
  text-decoration: none;
  transition: all 0.2s;
}
.toc-list a:hover { background: #f5f7fa; color: #409eff; }
.toc-list a.active { background: #ecf5ff; color: #409eff; font-weight: 600; }

.section-card { margin-bottom: 20px; }
.section-card h2 { margin: 0 0 12px; font-size: 20px; color: #303133; }
.section-card h3 { margin: 20px 0 10px; font-size: 16px; color: #303133; }
.section-card p { line-height: 1.8; color: #606266; }

.step-list { padding-left: 20px; line-height: 2; color: #606266; }
.step-list li { margin-bottom: 4px; }

.dot-list { padding-left: 20px; line-height: 2; color: #606266; }
.dot-list li { margin-bottom: 4px; list-style-type: disc; }

.code-block {
  background: #1f2d3d;
  color: #e6e8eb;
  padding: 12px 16px;
  border-radius: 6px;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
  overflow-x: auto;
  margin: 8px 0;
}

.info-table {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 13px;
}
.info-table th, .info-table td {
  border: 1px solid #ebeef5;
  padding: 8px 12px;
  text-align: left;
}
.info-table th {
  background: #f5f7fa;
  font-weight: 600;
  color: #303133;
}
.info-table td { color: #606266; }
.info-table code {
  background: #f5f7fa;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
  color: #d63384;
}

.mt-8 { margin-top: 8px; }
.mt-16 { margin-top: 16px; }

code {
  background: #f5f7fa;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 12px;
  color: #d63384;
}

@media (max-width: 991px) {
  .toc-card { position: relative; top: auto; margin-bottom: 16px; }
  .info-table { font-size: 12px; }
  .info-table th, .info-table td { padding: 6px 8px; }
}
</style>
