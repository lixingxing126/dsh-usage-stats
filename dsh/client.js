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
        '#' + ENTRY_ID + '{width:100%;height:32px;color:var(--dsw-alias-label-secondary,#8b949e);cursor:pointer;white-space:nowrap;background:transparent;border:none;border-radius:8px;display:flex;align-items:center;gap:8px;padding:0 12px;font-size:13px;font-family:inherit}',
        '#' + ENTRY_ID + ':hover{background:var(--dsw-specific-sidebar-nav-item-hover,rgba(127,127,127,.1));color:var(--dsw-alias-label-primary,#1f2328)}',
        '#' + ENTRY_ID + ' .ic{flex:none;display:inline-flex;align-items:center}',
        '#' + ENTRY_ID + ' .lb{text-overflow:ellipsis;overflow:hidden}',
        '[data-sidebar-collapsed] #' + ENTRY_ID + '{justify-content:center;padding:0}',
        '[data-sidebar-collapsed] #' + ENTRY_ID + ' .lb{display:none}',
        '#' + OVERLAY_ID + '{position:fixed;inset:0;z-index:9999;display:none;flex-direction:column;background:var(--dsw-alias-bg-base,#f6f7f9)}',
        '#' + OVERLAY_ID + '[data-open]{display:flex}',
        '#' + OVERLAY_ID + ' .bar{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e5ea)}',
        '#' + OVERLAY_ID + ' .title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328)}',
        '#' + OVERLAY_ID + ' .close{cursor:pointer;background:transparent;border:none;font-size:22px;line-height:1;color:var(--dsw-alias-label-secondary,#8b949e);padding:2px 6px}',
        '#' + OVERLAY_ID + ' iframe{flex:1;border:none;width:100%;background:#fff}',
      ].join('\n')
      document.head.appendChild(tag)
    }

    function sidebarRoot() {
      return document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
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
        '<span class="ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></svg></span>' +
        '<span class="lb">用量统计</span>'
      btn.addEventListener('click', function () {
        if (overlay.isOpen()) overlay.close()
        else overlay.open()
      })
      return btn
    }

    function mount() {
      injectStyle()
      var overlay = createOverlay()
      var entry = createEntry(overlay)
      var disposed = false

      var place = function () {
        if (disposed) return
        var root = sidebarRoot()
        if (!root) return
        if (entry.parentElement !== root) root.appendChild(entry)
      }

      // 侧边栏是 React 异步渲染的，等它出现再插入（自愈）。
      var observer = new MutationObserver(place)
      observer.observe(document.documentElement, { childList: true, subtree: true })
      place()

      var onKey = function (e) {
        if (e.key === 'Escape' && overlay.isOpen()) overlay.close()
      }
      document.addEventListener('keydown', onKey)

      return function () {
        disposed = true
        observer.disconnect()
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
