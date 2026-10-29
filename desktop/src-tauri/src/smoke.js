(async () => {
 const report = {checks:[], errors:[]};
 const check=(name,value)=>{report.checks.push({name,ok:!!value});if(!value)throw Error(name);};
 try {
  await new Promise(resolve=>setTimeout(resolve,1500));
  const api=window.electron;
  check("bridge injected",api?.isElectron&&api.config.apiUrl.startsWith("https://"));
  check("native IPC round trip",typeof await api.windowControls.isFullScreen()==="boolean");
  check("credentials disabled",await api.auth.getToken()===null);
  check("standalone Steam disabled",await api.steam.isActive()===false);
  check("standalone Apple Store disabled",await api.iap.isAvailable()===false);
  check("standalone Microsoft Store disabled",await api.msstore.isAvailable()===false);
  const local=await fetch("/en/local/");check("local route loads",local.ok&&(await local.text()).includes("<html"));
  const game=await fetch("/en/game/ABC123/index.txt");check("dynamic game route rewritten",game.ok&&(await game.text()).includes("__spa__"));
  const unprefixed=await fetch("/local/");check("default locale route",unprefixed.ok&&(await unprefixed.text()).includes("<html"));
  if(location.pathname.includes("computer")) {
    const cell=document.querySelector('[data-testid="cell-4-4"]');check("game board rendered",cell);
    const board=document.querySelector('[data-testid="tiao-board"]').getBoundingClientRect();
    const first=document.querySelector('[data-testid="cell-0-0"]').getBoundingClientRect();
    const center=cell.getBoundingClientRect();
    check("board CSS and positions applied",board.width>200&&board.height>200&&center.left>first.left+20&&center.top>first.top+20);
    cell.click();await new Promise(resolve=>setTimeout(resolve,200));
    check("human stone placed",document.querySelectorAll('[data-piece="white"]').length===1);
    for(let i=0;i<100&&!document.querySelector('[data-piece="black"]');i++)await new Promise(resolve=>setTimeout(resolve,100));
    check("AI Web Worker replied",document.querySelectorAll('[data-piece="black"]').length===1);
  }
  report.body=document.body.innerText.slice(0,2000);
  report.controls=[...document.querySelectorAll("a,button")].map(el=>({label:el.textContent,href:el.getAttribute("href")}));
  check("frontend rendered",report.controls.length>2&&report.body.length>20);
 } catch(error) {report.errors.push(String(error));}
 await window.__TAURI__.core.invoke("desktop_call",{channel:"runtime:smokeReport",args:[report]});
})();
