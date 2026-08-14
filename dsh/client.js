// dsh-usage-stats 客户端插件：在 Web UI 侧边栏注入「用量统计」入口，
// 点击后以 iframe 覆盖层打开宿主的 /usage-stats/panel 仪表盘。
// 纯 DOM 实现，无 React 依赖；与宿主插件同包（dsh.client 声明）。
window.__ModuleLoader__.load({
  id: 'dsh-usage-stats',
  factory: () => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var PANEL_URL = '/usage-stats/panel'
    var ENTRY_ID = 'dsh-usage-stats-entry'
    var OVERLAY_ID = 'dsh-usage-stats-overlay'
    var STYLE_ID = 'dsh-usage-stats-style'

    function injectStyle() {
      if (document.getElementById(STYLE_ID)) return
      var tag = document.createElement('style')
      tag.id = STYLE_ID
      tag.textContent = [
        '#' + ENTRY_ID + '{width:100%;height:32px;color:var(--dsw-alias-label-secondary,#8b949e);cursor:pointer;white-space:nowrap;background:transparent;border:none;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 12px;font-size:13px;font-family:inherit;flex:none}',
        '#' + ENTRY_ID + ':hover{background:var(--dsw-specific-sidebar-nav-item-hover,rgba(127,127,127,.1));color:var(--dsw-alias-label-primary,#1f2328)}',
        '#' + ENTRY_ID + ' .ic{flex:none;display:inline-flex;align-items:center}',
        '#' + ENTRY_ID + ' .lb{text-overflow:ellipsis;overflow:hidden}',
        '#' + OVERLAY_ID + '{position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;background:var(--dsw-alias-bg-base,#f6f7f9)}',
        '#' + OVERLAY_ID + '[data-open]{display:flex}',
        '#' + OVERLAY_ID + ' .bar{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e5ea);flex:none}',
        '#' + OVERLAY_ID + ' .title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328)}',
        '#' + OVERLAY_ID + ' .close{cursor:pointer;background:transparent;border:none;font-size:22px;line-height:1;color:var(--dsw-alias-label-secondary,#8b949e);padding:2px 6px}',
        '#' + OVERLAY_ID + ' iframe{flex:1;border:none;width:100%;background:#fff}',
      ].join('\n')
      document.head.appendChild(tag)
    }

    // 侧边栏外层 pane（布局层）
    function sidebarColumn() {
      return document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
    }

    // 真正插入按钮的容器：logo 行的父元素（侧边栏插件的 flex 列）
    function sidebarRoot() {
      var column = sidebarColumn()
      if (!column) return undefined
      var logoRow = column.querySelector('[class*="logoRow"]')
      if (logoRow && logoRow.parentElement) return logoRow.parentElement
      return column.firstElementChild || column
    }

    function createOverlay() {
      var wrap = document.createElement('div')
      wrap.id = OVERLAY_ID
      var bar = document.createElement('div')
      bar.className = 'bar'
      var title = document.createElement('span')
      title.className = 'title'
      title.textContent = '用量统计'
      var close = document.createElement('button')
      close.type = 'button'
      close.className = 'close'
      close.setAttribute('aria-label', '关闭')
      close.textContent = '×'
      bar.appendChild(title)
      bar.appendChild(close)
      var iframe = document.createElement('iframe')
      iframe.title = '用量统计'
      wrap.appendChild(bar)
      wrap.appendChild(iframe)
      document.body.appendChild(wrap)
      close.addEventListener('click', function () {
        wrap.removeAttribute('data-open')
      })
      return {
        open: function () {
          iframe.src = PANEL_URL
          wrap.setAttribute('data-open', '')
        },
        close: function () {
          wrap.removeAttribute('data-open')
        },
        isOpen: function () {
          return wrap.hasAttribute('data-open')
        },
        wrap: wrap,
      }
    }

    function createEntry(overlay) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.id = ENTRY_ID
      btn.setAttribute('aria-label', '用量统计')
      btn.innerHTML =
        '<span class="ic"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12.5v-3M2 12.5h3M12 3.5v3M12 3.5H9M3 2.5h10a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/></svg></span>' +
        '<span class="lb">用量统计</span>'
      btn.addEventListener('click', function () {
        if (overlay.isOpen()) overlay.close()
        else overlay.open()
      })
      return btn
    }

    // 找「新会话」按钮，把入口插在它下面一行（与 task-board 一致）。
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
      var overlay = createOverlay()
      var entry = createEntry(overlay)
      var disposed = false
      var root

      var tryPlace = function () {
        if (disposed) return
        if (root !== undefined && !root.isConnected) root = undefined
        if (root === undefined) root = sidebarRoot()
        if (root === undefined) return
        if (placeEntry(root, entry)) {
          rootObserver.observe(root, { childList: true, subtree: true })
          waitObserver.disconnect()
        }
      }

      // 等待 shell 渲染（body 级观察），就位后改为观察插入容器自愈。
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
        if (e.key === 'Escape' && overlay.isOpen()) overlay.close()
      }
      document.addEventListener('keydown', onKey)
      tryPlace()

      return function () {
        disposed = true
        waitObserver.disconnect()
        rootObserver.disconnect()
        document.removeEventListener('keydown', onKey)
        if (entry.parentElement) entry.parentElement.removeChild(entry)
        if (overlay.wrap.parentElement) overlay.wrap.parentElement.removeChild(overlay.wrap)
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
