// One shared tab strip for the original GSC overview and the Tayfun SEO workspace.
const tabs=document.getElementById('tayfunWorkspaceTabs');
const workspace=document.getElementById('tayfunApp');
function updateTabs(view=location.hash.slice(1)){
  if(!tabs)return;
  tabs.hidden=!['overview','tayfun'].includes(view);
  const active=view==='overview'?'overview':(workspace?.dataset.requestedMode||'groups');
  tabs.querySelectorAll('[data-tayfun-target]').forEach(button=>{
    button.setAttribute('aria-pressed',String(button.dataset.tayfunTarget===active));
  });
}
tabs?.querySelectorAll('[data-tayfun-target]').forEach(button=>button.addEventListener('click',()=>{
  const target=button.dataset.tayfunTarget;
  if(target==='overview'){location.hash='#overview';updateTabs('overview');return;}
  workspace.dataset.requestedMode=target;
  if(location.hash==='#tayfun')workspace.dispatchEvent(new Event('tayfun-mode-change'));
  else location.hash='#tayfun';
  updateTabs('tayfun');
}));
window.addEventListener('hashchange',()=>updateTabs());
updateTabs();

const globalReportToggle=document.getElementById('globalReportToggle');
const globalReportActions=document.getElementById('reportActions');
function closeReportMenu(){globalReportActions.classList.remove('is-open');globalReportToggle.setAttribute('aria-expanded','false');}
globalReportToggle.addEventListener('click',()=>{
 const open=!globalReportActions.classList.contains('is-open');
 globalReportActions.classList.toggle('is-open',open);
 globalReportToggle.setAttribute('aria-expanded',String(open));
});
document.addEventListener('click',e=>{if(!globalReportToggle.contains(e.target)&&!globalReportActions.contains(e.target))closeReportMenu();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&globalReportActions.classList.contains('is-open')){closeReportMenu();globalReportToggle.focus();}});
globalReportActions.addEventListener('click',e=>{if(e.target.closest('button,a'))closeReportMenu();});
