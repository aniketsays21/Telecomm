export const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }

  #tc-launcher {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #4f46e5;
    color: #fff;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 18px rgba(79,70,229,0.45);
    transition: transform 0.15s ease, box-shadow 0.15s ease;
    z-index: 2147483647;
  }
  #tc-launcher:hover { transform: scale(1.07); box-shadow: 0 6px 22px rgba(79,70,229,0.55); }

  #tc-window {
    position: fixed;
    bottom: 92px;
    right: 24px;
    width: 360px;
    max-height: 540px;
    background: #fff;
    border-radius: 18px;
    box-shadow: 0 8px 48px rgba(0,0,0,0.16);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: 2147483646;
    transition: opacity 0.18s ease, transform 0.18s ease;
  }
  #tc-window.tc-hidden { opacity: 0; pointer-events: none; transform: translateY(10px); }

  #tc-header {
    background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
    color: #fff;
    padding: 16px 18px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }
  #tc-header h2 { font-size: 15px; font-weight: 700; line-height: 1.3; }
  #tc-header p { font-size: 11px; opacity: 0.8; margin-top: 2px; }
  .tc-close {
    background: rgba(255,255,255,0.15);
    border: none;
    color: #fff;
    cursor: pointer;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 16px;
    transition: background 0.12s;
  }
  .tc-close:hover { background: rgba(255,255,255,0.25); }

  #tc-messages {
    flex: 1;
    overflow-y: auto;
    padding: 14px 14px 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 180px;
    scroll-behavior: smooth;
  }
  #tc-messages::-webkit-scrollbar { width: 4px; }
  #tc-messages::-webkit-scrollbar-track { background: transparent; }
  #tc-messages::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 2px; }

  .tc-msg { max-width: 84%; display: flex; flex-direction: column; gap: 3px; }
  .tc-msg.tc-user { align-self: flex-end; }
  .tc-msg.tc-bot { align-self: flex-start; }

  .tc-bubble {
    padding: 10px 13px;
    font-size: 13.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .tc-user .tc-bubble {
    background: #4f46e5;
    color: #fff;
    border-radius: 14px 14px 4px 14px;
  }
  .tc-bot .tc-bubble {
    background: #f3f4f6;
    color: #1f2937;
    border-radius: 14px 14px 14px 4px;
  }
  .tc-bot .tc-bubble.tc-err {
    background: #fef2f2;
    color: #dc2626;
    border: 1px solid #fee2e2;
  }

  .tc-time {
    font-size: 10.5px;
    color: #9ca3af;
    padding: 0 2px;
  }
  .tc-user .tc-time { text-align: right; }

  .tc-typing {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    padding: 12px 14px;
  }
  .tc-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #9ca3af;
    animation: tc-bounce 1.2s infinite ease-in-out;
  }
  .tc-dot:nth-child(2) { animation-delay: 0.2s; }
  .tc-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes tc-bounce {
    0%, 60%, 100% { transform: translateY(0); }
    30% { transform: translateY(-5px); }
  }

  #tc-escalated {
    background: #fffbeb;
    border-top: 1px solid #fef3c7;
    color: #92400e;
    font-size: 12px;
    padding: 8px 14px;
    text-align: center;
    line-height: 1.4;
  }

  #tc-input-area {
    padding: 10px 12px;
    border-top: 1px solid #e5e7eb;
    display: flex;
    gap: 8px;
    align-items: flex-end;
    background: #fff;
  }
  #tc-input-area textarea {
    flex: 1;
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 9px 12px;
    font-size: 13.5px;
    font-family: inherit;
    resize: none;
    min-height: 38px;
    max-height: 100px;
    line-height: 1.45;
    outline: none;
    color: #111827;
    background: #f9fafb;
    transition: border-color 0.15s;
  }
  #tc-input-area textarea:focus { border-color: #4f46e5; background: #fff; }
  #tc-input-area textarea::placeholder { color: #9ca3af; }
  #tc-input-area textarea:disabled { opacity: 0.5; }

  #tc-send {
    background: #4f46e5;
    color: #fff;
    border: none;
    border-radius: 10px;
    width: 38px;
    height: 38px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  #tc-send:hover { background: #4338ca; }
  #tc-send:disabled { background: #c7d2fe; cursor: not-allowed; }

  #tc-footer {
    font-size: 10px;
    color: #d1d5db;
    text-align: center;
    padding: 6px 12px 10px;
    background: #fff;
  }

  @media (max-width: 400px) {
    #tc-window { width: calc(100vw - 16px); right: 8px; bottom: 76px; }
    #tc-launcher { right: 12px; bottom: 12px; }
  }
`;
