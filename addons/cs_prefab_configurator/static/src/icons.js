const paths = {
 arrow:'M5 12h14m-5-5 5 5-5 5',back:'M19 12H5m5-5-5 5 5 5',check:'m5 12 4 4L19 6',close:'m6 6 12 12M6 18 18 6',
 save:'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8',
 share:'M12 16V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
 rotate:'M3 10a9 9 0 1 1 1 8M3 4v6h6',expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',
 ruler:'m3 16 13-13 5 5L8 21ZM7 12l2 2m1-5 2 2m1-5 2 2',
 cube:'m12 3 9 5v9l-9 5-9-5V8Zm0 19V12M3 8l9 4 9-4M7 5l9 5',
 plan:'M4 3h16v18H4ZM4 15h5v6M14 3v7h6',sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-6v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1',
 info:'M12 8h.01M11 12h1v5m0-15a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
 home:'m3 10 9-7 9 7v11H3Zm6 11v-8h6v8',leaf:'M20 3C8 2 1 9 5 16s16 3 15-13ZM4 21l10-12',
 shield:'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7Zm-5 9 3 3 6-6',
 download:'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6',plus:'M12 5v14M5 12h14',minus:'M5 12h14',
 chevron:'m9 5 7 7-7 7',mail:'M3 5h18v14H3Zm0 0 9 8 9-8',phone:'M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4c0 4-10 1-15-4S1 3 5 3Z',
 edit:'m15 4 5 5M4 20l5-1L21 7l-5-5L4 14ZM12 21h9',eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
 list:'M9 6h12M9 12h12M9 18h12M3 6h1m-1 6h1m-1 6h1',lock:'M5 10h14v11H5Zm3 0V6a4 4 0 0 1 8 0v4',
 clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',alert:'m12 3 10 18H2Zm0 6v5m0 3v.1',
 roof:'m2 13 10-9 10 9M5 10v10h14V10',light:'M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0l-1 2H9Z',
 undo:'M3 10h10a7 7 0 0 1 7 7v3M8 5l-5 5 5 5', copy:'M9 9h12v12H9ZM15 9V3H3v12h6',
 tree:'m12 3-7 9h3l-4 6h16l-4-6h3Zm0 15v4',floor:'m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5'
};
export function icon(name, cls='') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.info}"/></svg>`; }
