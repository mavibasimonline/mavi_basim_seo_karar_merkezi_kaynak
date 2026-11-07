// Automatic calendar rollover stays outside the size-constrained core entry bundle.
export function staleStoredMonth(pref,today){
 const previous=new Date(today+"-01T12:00:00Z");
 previous.setUTCMonth(previous.getUTCMonth()-1);
 const lastSeen=pref.calendarMonth||previous.toISOString().slice(0,7);
 return pref.month===lastSeen&&lastSeen<today;
}
export function installRollover({month,pickerYear,monthGrid,rangeMonths,currentMonth,monthLabel,allowed,choose,sync}){
 let opened=currentMonth();
 const check=()=>{
  const latest=currentMonth();
  if(latest===opened)return;
  const followed=month.value===opened&&rangeMonths.value==="1";
  opened=latest;
  if(!allowed().includes(latest)){
   month.add(new Option(monthLabel(latest),latest),0);
   pickerYear.replaceChildren(...[...new Set(allowed().map(v=>v.slice(0,4)))].map(y=>new Option(y,y)));
   monthGrid.dataset.year="";
  }
  if(followed)choose(latest,"1");
  else sync();
 };
 window.addEventListener("focus",check);
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)check();});
}

export const monthLabel=value=>new Intl.DateTimeFormat("tr-TR",{month:"long",year:"numeric",timeZone:"UTC"})
 .format(new Date(value+"-01T12:00:00Z")).replace(/^./,s=>s.toLocaleUpperCase("tr-TR"));
export function readPeriodPreference(key){try{return JSON.parse(localStorage.getItem(key)||"{}")||{};}catch{return {};}}
export function savePeriodPreference(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
