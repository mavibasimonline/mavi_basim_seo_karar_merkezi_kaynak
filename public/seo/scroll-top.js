// Fixed, keyboard-accessible quick jump for long Tayfun product and SEO pages.
const button=document.getElementById('scrollToTop');
const app=document.getElementById('app');
function update(){
  const page=document.scrollingElement;
  button.hidden=Boolean(app.hidden)||(page?.scrollTop||window.scrollY)<220;
}
button.addEventListener('click',()=>{
  const behavior=window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
  window.scrollTo({top:0,behavior});
  document.scrollingElement?.scrollTo({top:0,behavior});
});
window.addEventListener('scroll',update,{passive:true});
window.addEventListener('hashchange',update);
document.addEventListener('click',()=>requestAnimationFrame(update));
update();
