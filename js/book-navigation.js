// Resolve the EPUB attribute, never the iframe's browser-resolved anchor.href.
// Sanitized srcdoc frames inherit the reader URL after their <base> is removed.
const archiveOrigin='https://epub.invalid';
function pathname(value){try{return decodeURI(new URL(value,archiveOrigin+'/').pathname)}catch{return null}}
export function resolveBookLink(value,section,book){
 const href=String(value??'').trim();
 if(/^https?:\/\//i.test(href)||/^\/\//.test(href)){
  try{return{kind:'external',href:new URL(href,'https://epub.invalid/').href}}catch{return{kind:'blocked'}}
 }
 if(/^(mailto|tel):/i.test(href))return{kind:'external',href};
 if(href.startsWith('epubcfi(')){
  try{return book.spine.get(href)?{kind:'internal',target:href}:{kind:'missing'}}catch{return{kind:'missing'}}
 }
 if(/^[a-z][a-z\d+.-]*:/i.test(href)||!section?.href)return{kind:'blocked'};
 let dest;
 try{dest=new URL(href,archiveOrigin+'/'+section.href.replace(/^\//,''))}catch{return{kind:'blocked'}}
 const path=dest.pathname.slice(1);
 let decoded;try{decoded=decodeURI(path)}catch{return{kind:'blocked'}}
 let target=book.spine.get(path)||book.spine.get(decoded);
 if(!target){
  const wanted=pathname(dest.href);
  target=book.spine.spineItems.find(s=>pathname(s.href)===wanted||pathname(s.url)===wanted);
 }
 if(!target)return{kind:'missing'};
 return{kind:'internal',target:target.href+dest.hash,section:target,fragment:dest.hash.slice(1)};
}

export function installBookLinks(doc,section,book,rendition,{confirmExternal,openExternal,showError,navigate=target=>rendition.display(target)}){
 const click=event=>{
  const anchor=event.target?.closest?.('a[href]');
  if(!anchor)return;
  const link=resolveBookLink(anchor.getAttribute('href'),section,book);
  event.preventDefault();
  // Handle once, before epub.js's href-only handler and before the browser.
  event.stopImmediatePropagation();
  if(link.kind==='external'){
   if(confirmExternal('Open this external website?'))openExternal(link.href);
  }else if(link.kind==='internal'){
   if(link.fragment&&link.section?.index===section.index){
    let id;try{id=decodeURIComponent(link.fragment)}catch{showError('This book link has an invalid destination.');return}
    let targetEl=doc.getElementById(id)||doc.getElementById(link.fragment);
    if(!targetEl&&doc.querySelector){
     try{targetEl=doc.querySelector(`a[name="${CSS.escape(id)}"]`)||doc.querySelector(`a[name="${CSS.escape(link.fragment)}"]`)}catch{}
    }
    if(!targetEl){showError('This link does not point to a page in this book.');return}
   }
   Promise.resolve().then(()=>navigate(link.target)).catch(error=>showError(error.message||'Unable to open this book page.'));
  }else if(link.kind==='missing'){
   showError('This link does not point to a page in this book.');
  }else if(link.kind==='blocked'){
   showError('This link has an unsupported or invalid address.');
  }
 };
 doc.addEventListener('click',click,true);
 return()=>doc.removeEventListener('click',click,true);
}

export async function prepareBookChapters(book,nav,active=()=>true){
 const entries=[];
 const visit=items=>{for(const item of items||[]){entries.push({...item});visit(item.subitems)}};
 visit(nav?.toc);
 const documents=new Map();
 const positions=[];
 for(const entry of entries){
  if(!active())return;
  const section=book.spine.get(entry.href);
  if(!section)continue;
  try{
   if(!documents.has(section.index))documents.set(section.index,section.load(book.load.bind(book)));
   const loaded=await documents.get(section.index);
   if(!active())return;
   const doc=loaded.ownerDocument||loaded;
   const fragment=entry.href.split('#').slice(1).join('#');
   let target=null;
   if(fragment){
    let id=fragment;try{id=decodeURIComponent(fragment)}catch{}
    target=doc.getElementById(id)||doc.getElementById(fragment);
    if(!target&&doc.querySelector){
     try{target=doc.querySelector(`a[name="${CSS.escape(id)}"]`)||doc.querySelector(`a[name="${CSS.escape(fragment)}"]`)}catch{}
    }
   }
   if(!target)target=doc.body||doc.documentElement;
   if(target)positions.push({...entry,cfi:section.cfiFromElement(target),spineIndex:section.index});
  }catch{}
 }
 book.leafChapterPositions=positions;
 return positions;
}

export function restoreBookLocations(book,saved,compare){
 try{
  const locations=typeof saved==='string'?JSON.parse(saved):saved;
  if(!Array.isArray(locations)||locations.length===0)return false;
  for(let i=0;i<locations.length;i++){
   if(typeof locations[i]!=='string'||!locations[i].startsWith('epubcfi('))return false;
   if(i&&compare(locations[i-1],locations[i])>=0)return false;
  }
  book.locations.load(locations);
  return true;
 }catch{return false}
}
