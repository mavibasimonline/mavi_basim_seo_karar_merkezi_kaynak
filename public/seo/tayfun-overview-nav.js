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
