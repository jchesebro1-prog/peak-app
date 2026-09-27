/**
 * Styles for the catalog's part sidebar, fixture configurator, ask-a-question
 * form and curtain panel (#245 Task 11) — local `ps-*` classes in the same
 * palette as the browse page's `pc-*` (catalog-client.tsx). Accent only via
 * `var(--accent)`.
 */
export const PANEL_CSS = `
  .ps-scrim { position: fixed; inset: 0; background: rgba(22, 24, 29, .32); z-index: 60; animation: ps-fade .15s ease-out; }
  .ps-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(500px, 100vw); background: #fff; z-index: 61; display: flex; flex-direction: column; box-shadow: -12px 0 40px rgba(22, 24, 29, .16); animation: ps-slide .2s ease-out; }
  @keyframes ps-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes ps-slide { from { transform: translateX(24px); } to { transform: none; } }
  .ps-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 14px 12px 20px; border-bottom: 1px solid #eceef2; flex-shrink: 0; }
  .ps-head-label { font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #8c919c; }
  .ps-close { width: 34px; height: 34px; border-radius: 8px; border: none; background: transparent; color: #5b616e; font-size: 22px; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; text-decoration: none; }
  .ps-close:hover { background: #f1f2f5; color: #16181d; }
  .ps-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: 18px 20px 28px; display: flex; flex-direction: column; gap: 20px; }
  .ps-body > * { flex-shrink: 0; }
  .ps-gallery-main { aspect-ratio: 4 / 3; border: 1px solid #eceef2; border-radius: 12px; background: #fff; display: flex; align-items: center; justify-content: center; padding: 16px; overflow: hidden; }
  .ps-gallery-main img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .ps-gallery-empty { background: #f7f8fa; }
  .ps-thumbs { display: flex; gap: 8px; margin-top: 8px; overflow-x: auto; padding-bottom: 2px; }
  .ps-thumb { width: 58px; height: 58px; flex-shrink: 0; border-radius: 8px; border: 1.5px solid #e4e7ec; background: #fff; padding: 4px; cursor: pointer; }
  .ps-thumb img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .ps-thumb-on { border-color: var(--accent); }
  .ps-mfr { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #8c919c; }
  .ps-title { font-size: 19px; font-weight: 600; line-height: 1.3; letter-spacing: -.01em; margin: 4px 0 0; color: #16181d; }
  .ps-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; font-size: 12px; color: #6b717d; }
  .ps-meta b { font-weight: 600; color: #16181d; font-family: var(--font-mono); font-size: 11.5px; }
  .ps-desc { font-size: 13px; color: #5b616e; line-height: 1.6; margin-top: 8px; white-space: pre-wrap; }
  .ps-buy { background: #f7f8fa; border: 1px solid #eceef2; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
  .ps-price { font-family: var(--font-mono); font-size: 25px; font-weight: 600; color: #16181d; letter-spacing: -.01em; }
  .ps-price small { font-family: var(--font-ui); font-size: 12.5px; font-weight: 500; color: #8c919c; margin-left: 4px; letter-spacing: 0; }
  .ps-por { font-size: 17px; font-weight: 600; color: #16181d; }
  .ps-por-sub { font-size: 12px; color: #6b717d; margin-top: 3px; line-height: 1.5; }
  .ps-buy-row { display: flex; gap: 10px; align-items: stretch; }
  .ps-qty { display: inline-flex; align-items: stretch; border: 1px solid #d6d9e0; border-radius: 9px; background: #fff; overflow: hidden; height: 44px; flex-shrink: 0; }
  .ps-qty button { width: 38px; border: none; background: #fff; font-size: 18px; color: #16181d; cursor: pointer; }
  .ps-qty button:hover:not(:disabled) { background: #f1f2f5; }
  .ps-qty button:disabled { color: #c3c7ce; cursor: default; }
  .ps-qty input { width: 54px; border: none; border-left: 1px solid #eceef2; border-right: 1px solid #eceef2; text-align: center; font: 600 14px var(--font-mono); color: #16181d; outline: none; background: #fff; }
  .ps-qty input:focus { background: #fbfbfc; }
  .ps-off { opacity: .55; }
  .ps-add { flex: 1; min-width: 0; height: 44px; border-radius: 9px; border: 1px solid var(--accent); background: var(--accent); color: #fff; font: 600 14px var(--font-ui); cursor: pointer; padding: 0 16px; }
  .ps-add:hover:not(:disabled) { filter: brightness(.94); }
  .ps-add:disabled { opacity: .45; cursor: not-allowed; }
  .ps-add-sm { height: 32px; font-size: 12px; padding: 0 12px; flex: 0 0 auto; border-radius: 8px; }
  .ps-btn-ghost { height: 36px; border-radius: 9px; border: 1px solid #d6d9e0; background: #fff; color: #16181d; font: 600 13px var(--font-ui); cursor: pointer; padding: 0 14px; }
  .ps-btn-ghost:hover:not(:disabled) { border-color: #b9bec8; }
  .ps-btn-ghost:disabled { opacity: .45; cursor: not-allowed; }
  .ps-fine { font-size: 11.5px; color: #8c919c; line-height: 1.5; }
  .ps-err { font-size: 12.5px; color: #b42318; line-height: 1.5; }
  .ps-added { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #146c43; background: #ecf8f1; border: 1px solid #c9ebd8; border-radius: 9px; padding: 9px 12px; }
  .ps-added-tick { display: inline-flex; width: 18px; height: 18px; border-radius: 999px; background: #1f9d5a; color: #fff; font-size: 11px; align-items: center; justify-content: center; flex-shrink: 0; }
  .ps-added-link { color: #146c43; text-decoration: underline; text-underline-offset: 2px; }
  .ps-preview-hint { font-size: 12px; font-weight: 600; color: #8a6d1f; background: #fbf3dd; border: 1px solid #f0e2bd; border-radius: 8px; padding: 8px 11px; }
  .ps-sec-title { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #8c919c; margin-bottom: 8px; }
  .ps-list { border: 1px solid #eceef2; border-radius: 12px; overflow: hidden; }
  .ps-row { display: flex; align-items: center; gap: 11px; padding: 11px 13px; border-top: 1px solid #f0f1f4; min-width: 0; }
  .ps-row:first-child { border-top: none; }
  .ps-row-main { flex: 1; min-width: 0; }
  .ps-row-title { font-size: 13px; font-weight: 600; color: #16181d; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; text-decoration: none; }
  a.ps-row-title:hover { color: var(--accent); }
  .ps-row-sub { font-size: 11px; color: #8c919c; margin-top: 2px; font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ps-row-price { font-family: var(--font-mono); font-size: 12.5px; font-weight: 600; color: #16181d; white-space: nowrap; }
  .ps-row-por { font-size: 11.5px; font-weight: 600; color: #8c919c; white-space: nowrap; }
  .ps-doc-btn { display: flex; align-items: center; gap: 11px; width: 100%; padding: 11px 13px; border: none; background: #fff; text-align: left; cursor: pointer; font: inherit; color: inherit; }
  .ps-doc-btn:hover { background: #fafbfc; }
  .ps-doc-icon { width: 32px; height: 38px; border-radius: 5px; background: #fdf0ee; color: #c2410c; display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: .03em; flex-shrink: 0; }
  .ps-doc-kind { font-size: 11px; color: #8c919c; margin-top: 2px; }
  .ps-doc-chev { color: #9aa0ab; font-size: 13px; transition: transform .15s; }
  .ps-doc-open .ps-doc-chev { transform: rotate(90deg); }
  .ps-viewer { border-top: 1px solid #f0f1f4; background: #f7f8fa; padding: 10px; }
  .ps-viewer iframe { width: 100%; height: 560px; border: 1px solid #e4e7ec; border-radius: 8px; background: #fff; display: block; }
  .ps-viewer-bar { display: flex; justify-content: flex-end; gap: 14px; margin-top: 8px; }
  .ps-link { font-size: 12.5px; font-weight: 600; color: var(--accent); text-decoration: none; background: none; border: none; cursor: pointer; padding: 0; font-family: var(--font-ui); }
  .ps-link:hover { text-decoration: underline; }
  .ps-spec { font-size: 12.5px; line-height: 1.65; color: #2c3039; white-space: pre-wrap; word-break: break-word; font-family: var(--font-ui); margin: 0; background: #fafbfc; border: 1px solid #eceef2; border-radius: 12px; padding: 13px 14px; max-height: 360px; overflow-y: auto; }
  .ps-mini-img { width: 52px; height: 52px; border-radius: 8px; border: 1px solid #eceef2; background: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden; padding: 3px; }
  .ps-mini-img img { width: 100%; height: 100%; object-fit: contain; }
  .ps-mini-empty { background: #f7f8fa; }
  .ps-toggle { display: flex; align-items: center; gap: 11px; padding: 10px 13px; border-top: 1px solid #f0f1f4; }
  .ps-toggle:first-child { border-top: none; }
  .ps-toggle input[type=checkbox] { accent-color: var(--accent); width: 16px; height: 16px; margin: 0; cursor: pointer; flex-shrink: 0; }
  .ps-toggle .ps-qty { height: 32px; }
  .ps-toggle .ps-qty button { width: 28px; font-size: 15px; }
  .ps-toggle .ps-qty input { width: 40px; font-size: 12.5px; }
  .ps-inc-qty { font-family: var(--font-mono); font-size: 12px; color: #6b717d; white-space: nowrap; }
  .ps-field { display: flex; flex-direction: column; gap: 5px; }
  .ps-label { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #6b717d; }
  .ps-label span { text-transform: none; letter-spacing: 0; font-weight: 500; color: #9aa0ab; }
  .ps-input { width: 100%; border: 1px solid #d6d9e0; border-radius: 9px; padding: 9px 11px; font: 400 13.5px var(--font-ui); color: #16181d; background: #fff; outline: none; box-sizing: border-box; }
  .ps-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent); }
  .ps-input:disabled { background: #f7f8fa; color: #8c919c; }
  textarea.ps-input { resize: vertical; min-height: 96px; line-height: 1.5; }
  .ps-seg { display: flex; gap: 6px; flex-wrap: wrap; }
  .ps-seg button { flex: 1; min-width: 60px; height: 36px; border-radius: 8px; border: 1px solid #d6d9e0; background: #fff; font: 600 12.5px var(--font-ui); color: #16181d; cursor: pointer; }
  .ps-seg button.ps-seg-on { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 10%, #fff); color: var(--accent); }
  .ps-seg button:disabled { cursor: not-allowed; opacity: .6; }
  .ps-ask-toggle { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 13px 14px; border: 1px solid #eceef2; border-radius: 12px; background: #fff; cursor: pointer; font: 600 13.5px var(--font-ui); color: #16181d; text-align: left; }
  .ps-ask-toggle:hover { border-color: #d6d9e0; }
  .ps-card { border: 1px solid #eceef2; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
  .ps-unavail { text-align: center; padding: 48px 16px; }
  .ps-modal { position: fixed; z-index: 61; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 48px); background: #fff; border-radius: 14px; display: flex; flex-direction: column; box-shadow: 0 24px 60px rgba(22, 24, 29, .22); animation: ps-fade .15s ease-out; }
  .ps-modal .ps-body { gap: 14px; }
  .ps-grid3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .ps-hint { font-size: 12.5px; color: #5b616e; background: #f7f8fa; border-radius: 9px; padding: 9px 12px; }
  .ps-foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; padding: 12px 20px; border-top: 1px solid #eceef2; flex-shrink: 0; flex-wrap: wrap; }
  @media (max-width: 767px) {
    .ps-panel { width: 100vw; box-shadow: none; animation: ps-up .2s ease-out; }
    @keyframes ps-up { from { transform: translateY(24px); } to { transform: none; } }
    .ps-body { padding: 16px 16px 28px; }
    .ps-viewer iframe { height: 65vh; }
    .ps-modal { top: 0; left: 0; transform: none; width: 100vw; max-height: none; height: 100%; border-radius: 0; }
    .ps-grid3 { grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
  }
`;
