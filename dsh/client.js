// dsh-usage-stats 客户端插件：在 Web UI 侧边栏注入「用量统计」入口，
// 点击后在「会话区」内嵌打开 /usage-stats/panel 仪表盘（保留左侧栏），
// 与任务看板同一套挂载方式。纯 DOM 实现，无 React 依赖。
window.__ModuleLoader__.load({
  id: 'dsh-usage-stats',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var PANEL_URL = '/usage-stats/panel'
    var ENTRY_ID = 'dsh-usage-stats-entry'
    var VIEW_ID = 'dsh-usage-stats-view'
    var STYLE_ID = 'dsh-usage-stats-style'
    var ACTIVE_ATTR = 'data-dsh-usage-stats-active'

    function injectStyle() {
      if (document.getElementById(STYLE_ID)) return
      var tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = [
        '#' + ENTRY_ID + '{width:100%;height:32px;color:var(--dsw-alias-label-secondary,#8b949e);cursor:pointer;white-space:nowrap;background:transparent;border:none;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 12px;font-size:13px;font-family:inherit;flex:none}',
        '#' + ENTRY_ID + ':hover{background:var(--dsw-specific-sidebar-nav-item-hover,rgba(127,127,127,.1));color:var(--dsw-alias-label-primary,#1f2328)}',
        '#' + ENTRY_ID + ' .ic{flex:none;display:inline-flex;align-items:center}',
        '#' + ENTRY_ID + ' .lb{text-overflow:ellipsis;overflow:hidden}',
        '[data-pane="conversation"]{position:relative}',
        '#' + VIEW_ID + '{position:absolute;inset:0;z-index:5;display:none;flex-direction:column;background:#f4f5f9}',
        '@media (prefers-color-scheme: dark){#' + VIEW_ID + '{background:#0c0e14}}',
        'html[' + ACTIVE_ATTR + '] #' + VIEW_ID + '{display:flex}',
        'html[' + ACTIVE_ATTR + '] [data-pane="conversation"] > :not(#' + VIEW_ID + '){display:none}',
        '#' + VIEW_ID + ' .bar{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid #e8eaf1;flex:none;background:#ffffff}',
        '@media (prefers-color-scheme: dark){#' + VIEW_ID + ' .bar{background:#151823;border-bottom-color:#232838}}',
        '#' + VIEW_ID + ' .title{font-size:15px;font-weight:600;color:#1f2328}',
        '@media (prefers-color-scheme: dark){#' + VIEW_ID + ' .title{color:#e7e9f0}}',
        '#' + VIEW_ID + ' .close{cursor:pointer;background:transparent;border:none;font-size:22px;line-height:1;color:#8b949e;padding:2px 6px}',
        '@media (prefers-color-scheme: dark){#' + VIEW_ID + ' .close{color:#98a0b3}}',
        '#' + VIEW_ID + ' iframe{flex:1;border:none;width:100%;background:#fff}',
      ].join('\n')
      document.head.appendChild(tag)
    }

    function sidebarColumn() {
      return document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
    }

    function sidebarRoot() {
      var column = sidebarColumn()
      if (!column) return undefined
      var logoRow = column.querySelector('[class*="logoRow"]')
      if (logoRow && logoRow.parentElement) return logoRow.parentElement
      return column.firstElementChild || column
    }

    function conversationPane() {
      return document.querySelector('[data-pane="conversation"]')
    }

    function isOpen() {
      return document.documentElement.hasAttribute(ACTIVE_ATTR)
    }

    function open() {
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
    }

    function close() {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }

    function createView() {
      var wrap = document.createElement('div')
      wrap.id = VIEW_ID
      var bar = document.createElement('div')
      bar.className = 'bar'
      var title = document.createElement('span')
      title.className = 'title'
      title.textContent = '用量统计'
      var closeBtn = document.createElement('button')
      closeBtn.type = 'button'
      closeBtn.className = 'close'
      closeBtn.setAttribute('aria-label', '关闭')
      closeBtn.textContent = '×'
      bar.appendChild(title)
      bar.appendChild(closeBtn)
      var iframe = document.createElement('iframe')
      iframe.title = '用量统计'
      wrap.appendChild(bar)
      wrap.appendChild(iframe)
      closeBtn.addEventListener('click', close)
      return { wrap: wrap, iframe: iframe }
    }

    function createEntry(view) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.id = ENTRY_ID
      btn.setAttribute('aria-label', '用量统计')
      btn.innerHTML =
        '<span class="ic"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12.5v-3M2 12.5h3M12 3.5v3M12 3.5H9M3 2.5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/></svg></span>' +
        '<span class="lb">用量统计</span>'
      btn.addEventListener('click', function () {
        if (isOpen()) close()
        else {
          view.iframe.src = PANEL_URL
          open()
        }
      })
      return btn
    }

    function placeEntry(root, entry) {
      var newSession = root.querySelector('button[class*="newSession"]')
      if (!newSession) {
        for (var i = 0; i < root.children.length; i++) {
          var c = root.children[i]
          if (c.tagName === 'BUTTON') {
            newSession = c
            break
          }
        }
      }
      if (!newSession) return false
      if (entry.parentElement !== root) {
        var row = newSession.closest('[class*="logoRow"]')
        var base = row && row.parentElement === root ? row : newSession
        root.insertBefore(entry, base.nextElementSibling)
      }
      return true
    }

    function mount() {
      injectStyle()
      var view = createView()
      var entry = createEntry(view)
      var disposed = false
      var root
      var pane

      var placeView = function () {
        if (disposed) return
        if (pane && !pane.isConnected) pane = null
        if (!pane) pane = conversationPane()
        if (!pane) return
        if (view.wrap.parentElement !== pane) pane.appendChild(view.wrap)
      }

      var tryPlace = function () {
        if (disposed) return
        if (root !== undefined && !root.isConnected) root = undefined
        if (root === undefined) root = sidebarRoot()
        if (root !== undefined && placeEntry(root, entry)) {
          rootObserver.observe(root, { childList: true, subtree: true })
          waitObserver.disconnect()
        }
        placeView()
      }

      var waitObserver = new MutationObserver(tryPlace)
      waitObserver.observe(document.body, { childList: true, subtree: true })
      var rootObserver = new MutationObserver(function () {
        if (root === undefined || !root.isConnected) {
          root = undefined
          tryPlace()
          return
        }
        if (!root.contains(entry)) placeEntry(root, entry)
      })

      var onKey = function (e) {
        if (e.key === 'Escape' && isOpen()) close()
      }
      document.addEventListener('keydown', onKey)
      tryPlace()

      return function () {
        disposed = true
        waitObserver.disconnect()
        rootObserver.disconnect()
        document.removeEventListener('keydown', onKey)
        close()
        if (entry.parentElement) entry.parentElement.removeChild(entry)
        if (view.wrap.parentElement) view.wrap.parentElement.removeChild(view.wrap)
        var style = document.getElementById(STYLE_ID)
        if (style && style.parentElement) style.parentElement.removeChild(style)
      }
    }

    function apply(ctx) {
      ctx.effect(mount, 'usage-stats: sidebar entry')
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
