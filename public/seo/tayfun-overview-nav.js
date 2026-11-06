// Navigate to the existing Tayfun workspace without duplicating GSC/dashboard data.
const root=document.getElementById('overviewTabs');
root?.querySelectorAll('[data-tayfun-mode]').forEach(button=>{
 button.addEventListener('click',()=>{
  document.getElementById('tayfunApp').dataset.requestedMode=button.dataset.tayfunMode;
  if(location.hash==='#tayfun')window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash='#tayfun';
 });
});
